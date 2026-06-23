# Architecture

How HOTLINE fits together. Read this before changing picks, scoring, brackets,
or outcome resolution.

## Stack & topology

- **Next.js (App Router) + TypeScript**, `output: standalone`. One container.
- **Prisma + SQLite** on a `/data` bind mount (a real disk, never a FUSE `/mnt/user`
  share — WAL locking breaks on FUSE).
- Deploys to the **`phattvip` Docker network** behind **SWAG** at `pickems.phatt.vip`.
- Responsive **installable PWA** is the entire mobile story. No native apps. A small
  **service worker** (`public/sw.js`) handles web-push and self-heals stale cached builds —
  see *Client resilience* below.
- Two shared services on the same network, reachable **by container name**. Neither
  is a *hard* requirement — the app boots and serves every page without them:
  - `crawl4ai:11235` — renders/bypasses Cloudflare for the live HLTV scrape.
    **Soft/runtime dependency:** only the two live-HLTV features (Swiss W-L standings
    + team "Last 5" dossiers) need it, and they **degrade gracefully to empty/stale**
    if it's unreachable (`CRAWL4AI_URL`, default `http://crawl4ai:11235`). Auth, picks,
    leaderboard, reveals, brackets, and notifications don't touch it.
  - `browserless:3000` — real Chrome, used for screenshots / verification only.
    **Not a runtime dependency** — the deployed app never calls it; it exists for
    dev/QA tooling.

The container's own **hard requirements** are just: a SQLite `/data` bind on real
disk (`DATABASE_URL`), the public origin (`NEXTAUTH_URL`), a fixed session secret
(`NEXTAUTH_SECRET`), the `phattvip` network, and SWAG fronting port 3000 — plus
`STEAM_API_KEY` + `AUTH_CODE_ENCRYPTION_KEY` for live Steam read/write. Everything
else (push/VAPID, crawl4ai, Turnstile, write-back) is feature-gated and optional.
Full var-by-var table in [OPERATIONS.md](OPERATIONS.md#environment-variables).

Deploy = Brandon **Force Update** on Unraid (pulls the new ghcr image and recreates).
A fresh DB self-migrates on boot — the image `CMD` (`Dockerfile:74`) runs
`prisma db push --skip-generate` before starting the server (see OPERATIONS.md).

## The one pattern to understand first: `-core` leaf modules

Almost every piece of domain logic is split in two:

- **`src/lib/<thing>-core.ts`** — *pure* logic. No DB, no `fetch`, no `process.env`,
  no Next imports. Takes plain data in, returns plain data out. This is where the rules
  live (bucketing, scoring weights, lock math, clinch status, consensus, reveal gates).
- **`src/lib/<thing>.ts`** — the IO sibling. Does the DB reads/writes, the `fetch`, the
  `after()` scheduling, and calls into `-core` for the decisions.

Why it matters: every `-core` module has an **offline verifier** under
`scripts/verify-*.ts` that runs with no bundler and no DB:

```bash
node scripts/verify-all.mjs        # the whole suite (PHA-925 zero-dep resolver hook)
# single verifier (mirror what the runner does, for extensionless value-imports):
node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs --no-warnings scripts/verify-swiss-results.ts
```

These are the test suite. When you change a `-core` module, run its verifier; if you
add logic, add cases. A `-core` module must stay a **leaf** (importing only other
leaves / pure helpers) or the verifier can't load it standalone.

## Data flow, end to end

```
  Steam OpenID  ──┐
                  ├─►  Session (JWT cookie `phatt_session`)  ──►  middleware entry gate
  Local player  ──┘                                                (splash unless signed in)
                         │
                         ▼
                   /picks  ──►  POST /api/picks  ──►  Pick rows (local DB)
                         │            ▲
            (Steam users)│            │ stage writable?  stage-gate-core (picks_allowed + seeded)
                         │            │                  lock-schedule-core (isLockTimePassed)
                         ▼            │
              /api/picks/sync  ◄──────┘   read  : GetTournamentPredictions → mirror into Pick
              /api/picks/sync-stage      write : UploadTournamentPredictions  (WRITE_ENABLED gate)
                         │
                         ▼
   OUTCOMES (resolved into StageOutcome rows)
     1. Valve oracle  : fetchTournamentLayout → resolveOutcomesFromLayout   (the answer key)
     2. on-read driver: refreshOutcomesOnRead (atomic claim + after())  → StageOutcome rows
     3. live HLTV bridge: bridgeSwissOutcomes / refreshLiveResultsTick — score live 3-0/0-3
                          Swiss clinches before Valve seeds the key (PHA-918/1109)
                         │
                         ▼
   SCORING  scoring.ts  ──►  /api/leaderboard   (bucket-aware weighting; picks hidden until lock)
                         │
                         ├─►  reveal-core  : picks stay hidden until the stage locks
                         │                   invariant: revealed === !writable
                         └─►  consensus-core: "lone pick" / bucket-share lines on compare + profile

   LIVE BOARDS (display only, do NOT feed scoring except via PHA-918 bridge)
     Swiss standings/bracket : HLTV event pages → crawl4ai → swiss-results(-core) → SwissStandingsCache
                               gated by isWithinRefreshWindow (opens 24h before lock → match-window end)
     Team dossier (Last-5)   : HLTV profiles → crawl4ai (batch 32, retry) → TeamStatsCache (team-stats.ts)
                               gated by isWithinAnyMatchWindow; merged over the frozen snapshot
     Playoff bracket         : committed layout (108/109/110) + StageOutcome, NO crawl;
                               ONE interactive QF→SF→GF picker (PHA-1204), QF field seeded from the layout
```

## The subsystems

### Auth & session
- **Steam**: `/api/auth/steam` → OpenID 2.0 → `/api/auth/steam/callback` upserts a Player
  and issues the `phatt_session` JWT. SteamID64s are bigint — handle as strings end to end.
- **Local**: `/api/auth/local` creates a no-Steam player. Dedup rules in `local-auth-core.ts`.
- **Entry gate**: middleware redirects un-entered visitors to the splash/login. It keys on
  `phatt_session` (and the `hotline_entered` cookie) — see GOTCHAS for the live nuance.

### Picks
- `/picks` renders Swiss stages as **2 / 6 / 2 buckets** (advance 3-0 / advance / eliminated 0-3),
  computed by `swiss-bucket-core`. Playoffs render as **one interactive QF→SF→GF bracket**
  (`PlayoffBracketPicker` + `playoff-bracket-core.ts`: `buildPlayoffPickTree` / `resolveBracketPicks`
  / `playoffFieldTeams`, PHA-1204) — tap a winner and they advance; `POST /api/picks` accepts the
  downstream SF/GF picks against the QF field.
- A pick is writable only if the stage is **pickable** (`stage-gate-core`: `picks_allowed` +
  `isSectionSeeded`) **and** not past its **lock time** (`lock-schedule-core`).
- **A schedule lock has three surfaces**: the picker (UI), the write-guard (`POST /api/picks`
  → 409 `stage_locked`), and the reveal/compare gate. Miss one and picks leak. (GOTCHAS.)

### Steam mirror (read + write)
- Read (`/api/picks/sync`) pulls `GetTournamentPredictions` and mirrors into `Pick`. Valve's
  response uses the field `pick`, **not** `pickid`, and omits `sectionid` — map it back yourself.
- Write (`/api/picks/sync-stage`) is **destructive** and gated by `WRITE_ENABLED`. Returns a
  `WriteResult` (`ok` / `skipped` / `degraded` / `escalate`); the UI pill copies from that shape.

### Outcomes & scoring
- The **Valve oracle** is the truth source once Valve seeds the bracket layout:
  `fetchTournamentLayout` + `resolveOutcomesFromLayout` turn the layout's winning pickids
  into `StageOutcome` rows.
- `refreshOutcomesOnRead` fires that resolve from every outcome-reading surface, using an
  **atomic SourceState claim + Next `after()`** so only one request does the work and the
  response isn't blocked. Every on-read driver (outcomes, Swiss standings, team stats,
  Spotlight odds, news) shares this claim / stamp / defer machinery from
  `src/lib/source-refresh.ts` — PHA-1271 folded six byte-identical copies into one helper.
- `scoring.ts` scores picks against `StageOutcome` with **bucket-aware** weighting (a Swiss
  bucket pick is right if the team landed in that bucket, not a single exact slot).

### Live boards (HLTV)
- Valve has **no W-L** mid-stage, so the live Swiss standings/bracket come from **HLTV event
  pages**, fetched through **crawl4ai** (direct fetch is 403 Cloudflare). `swiss-results.ts`
  claims an ~hourly refresh slot, crawls, and persists a `SwissStandingsCache` JSON blob;
  `swiss-results-core` parses it. Map scores live in HLTV's `data-match-details-popup-json`
  (the markdown rendering drops them — read the HTML).
- The crawl is **gated by `isWithinRefreshWindow`** — the window opens **24h before each stage
  locks** (the bracket-reveal lead, PHA-943) and runs through the stage's match-window end, so the
  live bracket can appear before the first match. (Was `isWithinMatchWindow` = match-days-only.)
- The **playoff bracket** needs no crawl: its tree comes from the committed layout and fills
  from `StageOutcome`. It is the interactive QF→SF→GF picker (see Picks above); the QF field is
  seeded from the committed layout once Stage 3 resolves, and tapping a winner advances them.
- **Team dossier (Last-5):** the roster + world-rank ship as a frozen snapshot (`team-stats-core`),
  but the **recent results auto-refresh live** — `refreshTeamStatsOnRead` (`team-stats.ts`) runs the
  same atomic-claim + `after()` deferred crawl as the standings/outcomes drivers, batching all 32 HLTV
  **profiles** in one crawl4ai request (with up to 3 retry passes for Cloudflare-challenged teams) and
  persisting a one-row-per-event `TeamStatsCache`. Gated by `isWithinAnyMatchWindow`. The read path
  always merges live `recent[]` over the frozen snapshot, so the drawer never renders empty. Warm via
  `GET /api/team-stats/refresh` (PHA-921).

### Reveal / compare
- `reveal-core` keeps a player's picks hidden until the stage locks. Core invariant:
  `revealed === !writable`. The compare page and `players/[id]` both pass through it.
- The compare grid / steal reel judge a Swiss pick **at bucket grain** (`resolveBucketWinners`
  / `bucketPickState` in `swiss-bucket-core`, PHA-946) — same grain as `scoring.ts`, so a pick
  that scored as correct can't render as a miss just because it sat in a different slot.
- **Two independent reveal gates — don't conflate them.** *Player-pick* reveal stays at lock
  time (`reveal-core`). The *live Swiss bracket* reveals **24h before lock** —
  `bracketRevealTime(section) = lockAt − BRACKET_REVEAL_LEAD_MS (24h)` / `isBracketRevealed` in
  `lock-schedule-core.ts` (PHA-943). So in the 24h pre-lock window the public HLTV bracket renders
  beneath the picker while the picker is still open, but **no player's picks are exposed** — the
  bracket shows only public HLTV match data + the viewer's own picks. The early bracket reveal does
  not touch the `revealed === !writable` invariant.

### Event registry & lifecycle (multi-major)
- `events-core.ts` holds the `EVENTS` registry; **every RSC and API route resolves the active
  event per request** via `currentEventId(now)` — never a module-level constant. PHA-1046 removed
  the module-load-bound `ACTIVE_EVENT_ID` / `SECTION_SOURCES` precisely so a long-lived process
  can't pin yesterday's event.
- `event-lifecycle-core.ts` derives `upcoming → live → archived` from the clock
  (`resolveEffectiveStatus` / `selectCurrentEvent`). `ANTICIPATION_LEAD_MS` (~45d) keeps the
  just-archived Major as the face of the site through the off-season until the next is near go-live;
  `GRAND_FINAL_ARCHIVE_GRACE_MS` (48h) delays archive after the Grand Final. Seeding a new Major as
  `status:"upcoming"` with real dates is all it takes — no hand flip. PGL Singapore 2026 (eventId 27)
  is already seeded this way. See [ROADMAP-MULTI-MAJOR.md](ROADMAP-MULTI-MAJOR.md).

### The Bleachers — semi-anonymous pick reactions (PHA-1211)
- On a **revealed** pick, players drop a fixed **stamp** (one of `bleachers-core.ts` `STAMPS`) via
  `POST /api/reactions` → a `Reaction` row. Pure tally/sort logic is in `bleachers-core.ts`; the
  `BleachersStrip` component renders the public count per stamp. **One stamp per sender per target
  pick** (`@@unique([senderId,eventId,sectionId,groupId,slotIndex,targetPlayerId])`, a repeat is a
  swap), and the **sender stays masked** in the UI until the stage resolves — anonymous in the
  moment, unmasked at resolve. Unknown `stampId`s are rejected at the API boundary and skipped on read.
- **`targetPlayerId` is part of the unique key for a reason (PHA-1262).** Playoff bracket groups are
  shared across all players (everyone picks into the same QF/SF/GF slots), so without the target in
  the key, reacting to a second player at the same `(section,group,slot)` collided with and silently
  re-stamped the first. Include the target.
- **Reactions stay open match-by-match in the playoffs (PHA-1262/1266).** A Swiss stage closes
  reactions for the whole stage once it resolves, but the playoff bracket resolves one match at a
  time, so the "resolved → read-only" gate is exempted for playoff sections (on the profile page,
  the compare page, and the `POST /api/reactions` 409 guard) — a decided QF still accepts stamps
  until the whole bracket is archived. After lock the viewer's own bracket renders read-only rather
  than hidden (PHA-1263), so crowns and their stamps stay visible.

### Cross-device local login + local→Steam claim (PHA-1210 / 1232)
- A local (no-Steam) player can play on a second device without re-onboarding: `POST /api/auth/local/token`
  mints an opaque `Player.loginToken`; `GET /api/auth/token-login?t=…` validates it and issues a session
  (panels: `LoginTokenPanel` on `/profile`, `TokenSignInPanel` on `/login/local`).
- If a guest later signs in with Steam, their guest picks would be stranded (the Steam callback upserts by
  `steamId` only). `POST /api/auth/local/claim` merges the guest/local account's picks onto the signed-in
  Steam account (origin-guarded). Core merge logic in `local-merge-core.ts`.

### Playoff Spotlight odds (PHA-1066)
- `spotlight-odds.ts` runs the same on-read atomic-claim + `after()` driver to pull **Polymarket
  gamma-api moneyline** lines into the playoff Spotlight modal, warmable via `GET /api/odds/refresh`.
  Gated empty until the `PLAYOFF_MARKET_SLUGS` registry (`spotlight-odds-core.ts`) is seeded.
  Display-only — never touches scoring.

### Stage Wrapped (recap) + Major Wrapped (PHA-1274)
- A click-through "Stage Wrapped" recap popup driven by `stage-wrapped-core.ts` (data-driven
  `WrappedSlide[]`) + `stage-wrapped-launch(-core).ts`, gated app-wide by `StageWrappedGate` in
  `(app)/layout.tsx` (PHA-1051/1052). Content lives in `stage-wrapped-content.ts`. Presentational —
  no scoring path. The shell carries a `WRAPPED_TRACKS` soundtrack registry (**bittersweet** default →
  epic → somber) with a mood cycle beside the off-by-default sound toggle. Content model:
  [STAGE-WRAPPED-CONTENT-MODEL.md](STAGE-WRAPPED-CONTENT-MODEL.md).
- **Major Wrapped** is the end-of-event finale recap — same `WrappedSlide[]` shell, no new UI. It
  reuses the deck as a *32-teams-walked-in-one-walked-out* arc (`playoff-wrapped-core.ts` builds the
  deck; `playoff-wrapped-derive.ts` → `prepareMajorWrappedAutoDeck()` derives the storylines from the
  resolved `StageOutcome` rows — champion road, runner-up, biggest upset, Cinderella). It is **hard
  GF-gated**: the derive returns `null` until the Grand Final has a winner, so the deck stays empty
  mid-bracket and auto-opens (deferred-to-idle, once per viewer) only after the champion is crowned.
  Curated per-Major historic-moment photos live in `public/wrapped/` (credited in
  `public/wrapped/CREDITS.md`). The playoffs reveal as a **single** "Playoffs" stage (not per-round
  QF/SF/GF), and the home recap CTA / recap notification open the real Major Wrapped deck; the final
  slide sends you to the coin you just earned (PHA-1274).

### Notifications (PHA-1211 / 1236–1245)
- A unified in-app notification feed for signed-in players. `notifications-core.ts` assembles a
  typed `kind: "reaction" | "stage" | "recap" | "announcement" | "coin"` feed (reactions on your
  picks, upcoming stage-lock reminders at 24h + 1h, recap availability, author-in-code broadcasts,
  and the celebratory **coin-earned** ping when a Major you played concludes — `coin-earned-pushes.ts`,
  push-on by default, PHA-1278);
  `notifications-feed.ts` is its server fetcher. Read state is per-item (`NotificationRead` rows,
  keyed `(playerId, entryId)`) over a `Player.notificationsSeenAt` watermark; per-kind in-app/push
  toggles live in `Player.notifPrefs` (JSON).
- Routes: `GET/POST /api/notifications` (feed / mark-all-seen), `GET/PATCH /api/notifications/prefs`,
  and `GET /api/notifications/stream` — an **SSE** stream that replaced the old 45s poll for instant
  delivery + toasts. The SSE loop is CPU-hardened (a `cancel` flag + `safeEnqueue` + a 10-minute
  lifetime cap) after a poll-loop leak pinned CPU (PHA-1244 — see GOTCHAS).
- Web-push parity for every kind (`notify-core.ts` payload builders + the `public/sw.js` push
  handler) plus a PWA app-icon badge and `(N)` tab-title prefix (PHA-1238). Push needs the VAPID
  keys (OPERATIONS → env); without them the feed still works in-app, push just hides.

### Client resilience — service worker & freeze defenses (PHA-1267/1268/1269)
- `public/sw.js` is deliberately **cache-light**: it never caches app content (everything is live,
  server-rendered), interposes only on top-level document navigations, and stays out of SSE / API /
  static-asset requests so it never holds streaming buffers. Its job is *recovery*: `skipWaiting()` +
  `clients.claim()` on activate, it **purges all Cache Storage** and broadcast-reloads stuck clients
  onto the fresh build — the one mechanism that reaches an installed PWA pinned to stale HTML. A
  ChunkLoadError / failed-`/_next/static` self-heal (inline script in `layout.tsx`, sessionStorage
  loop-guard) drops the SW + caches and hard-reloads on a stale-build white screen. `/sw.js` is
  served uncacheable so updates land immediately.
- The "freezes the whole browser" class of bug was **GPU/compositor, not JS heap** — full-viewport
  `backdrop-filter: blur()` re-blurred every frame. Those blurs were removed; the rule and the rest
  of the saga (AutoRefresh heap bound, SSE pause on hidden tab, prefetch-storm) are in GOTCHAS.

### Analytics — self-hosted, cookieless (PHA-1277)
- First-party, in-app, **one container** (no Umami, no external service). A tiny inline tracker
  `sendBeacon()`s to `POST /api/stats/collect`, which writes one `PageView` row. No PII: `country`
  comes from the `CF-IPCountry` header (never an IP), `visitor` is a daily-rotating salted IP+UA
  hash (counts unique visitors / sessions without cross-day tracking), and the collector is
  same-origin-guarded, Do-Not-Track-aware, and per-IP rate-limited. Pure parsing/sessionizing lives
  in `analytics-core.ts`. The owner dashboard `/admin/analytics` shows traffic, device/browser/OS/
  country splits, referrers, entry/exit, bounce, sessions, custom events, and product metrics.

### Challenge coins — collectible Major keepsakes (PHA-1278)
- A collectible coin per Major you **participated in** (≥1 real pick) once that Major **concludes** —
  it mints the moment the Grand Final crowns a champion (`grandFinalResolvedAtMs`; `dates.end` is only
  a backstop), **not** after the GF+48h archive grace (PHA-1274). `isCoinEarned` (`participated &&
  archived`) in `challenge-coin-core.ts`. The tier (diamond / gold / silver / bronze) is your
  finish percentile (`coinTierForFinish` against `TIER_CUTOFFS`; the outright winner is always
  diamond). Pure derivation only — **no new table**; `challenge-coins.ts` reads the same picks +
  `StageOutcome` rows as `/majors` and short-circuits to zero work until an event archives.
- Rendered as a red-velvet display case (`ChallengeCoinShelf`) on `/players/{id}` and on each
  concluded `/majors` row, with a drag-to-rotate CSS-3D `CoinInspector` (no WebGL). Art is a
  **per-Major seam**: front PNGs `public/coins/<event-slug>-{tier}.png` (`coinArtSrc`) over shared
  reverses `public/coins/_back-{tier}.png` — see NEXT-MAJOR.

## Where the per-major seams are

Everything that changes for the *next* Major is committed config, not fetched. The
full list and the order to change it is in **[NEXT-MAJOR.md](NEXT-MAJOR.md)**. The
short version:

- `lock-schedule-core.ts` — `COLOGNE_LOCK_SCHEDULE` (section → lock instant) + `COLOGNE_MATCH_WINDOWS`
  + `COLOGNE_PLAYOFF_SCHEDULE` (per-game playoff times that derive the playoff locks, PHA-1007).
- `events-core.ts` — the per-section HLTV event URLs live in the `EventConfig.sectionSources` registry
  (the old module-level `SECTION_SOURCES` const in `swiss-results.ts` was removed in PHA-1046; resolved
  per request via `sectionSourcesFor(eventId)`).
- Team / pickid / region / logo / stats maps — one file each, keyed by Valve pickid.
- The committed bracket layout (sections 105–110).

## Does HOTLINE need an LLM / agent running?

**No. The running app has zero LLM dependency for end-user usage.** This matters for
"more majors" — the thing must keep working when no agent is around.

- **No AI at runtime.** There is no LLM SDK in `package.json` and no LLM API call
  anywhere in `src/` or `scripts/`. Login, picking, scoring, leaderboards, brackets,
  and live standings are plain TypeScript + Prisma/SQLite. If every LLM/agent vanished
  forever, a deployed HOTLINE keeps serving the current event **exactly as-is**.
- **The data pipeline is deterministic scraping, not AI.** The only external calls are
  the Steam Web API (`api.steampowered.com`), HLTV (fetched through `crawl4ai` purely to
  bypass Cloudflare — `cache_mode: "BYPASS"`, **no** LLM extraction strategy; the app
  parses the raw markdown/HTML itself with committed regex), Liquipedia, Cloudflare
  Turnstile (CAPTCHA), and **Polymarket gamma-api** (display-only Spotlight odds, PHA-1066).
  Outcomes come from Valve's tournament layout + the HLTV parse; scoring is pure code (`scoring.ts`).
- **What needs an *operator* (a human — or, conveniently, an agent — but never an LLM at
  runtime):**
  - **Deploy** a new image → Brandon's Unraid Force Update.
  - **Per-event setup** for the next Major → edit the committed config seams above
    (the [NEXT-MAJOR.md](NEXT-MAJOR.md) runbook; doable by a person).
  - **Per-stage upkeep** → warm the standings cache after a deploy
    (`GET /api/standings/refresh` — any HTTP poke / uptime monitor works), refresh team
    stats, and apply a new stage's HLTV source. These are committed scripts
    (`build-logos.ts`, `gather-team-stats.ts`, `check-stage3-source.ts`) and on-read
    drivers, increasingly automated by routines — **none require an LLM.**

**Bottom line:** end-user gameplay is fully autonomous code; an agent has been a
*convenience* for setup/ops, not a runtime requirement. The one place this used to leak
— a fresh-DB cold start that wedged the on-read refresh driver until someone manually
poked it — was fixed (see `verify-source-state-claim.ts`), making a fresh deploy *more*
self-sufficient, not less.
