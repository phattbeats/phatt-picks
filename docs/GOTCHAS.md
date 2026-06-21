# Gotchas — hard-won lessons

Each entry: the **symptom**, the **cause**, the **rule** that prevents the repeat.
These cost real hours. Add to this file whenever a bug burns you.

---

## Deploy & infrastructure

### Deploying = Brandon "Force Update" on Unraid
- **Cause:** the live container is unmanaged by the agent toolchain. The `phatt-claw`
  Docker socket proxy (`http://phatt-claw:2375` — hostname, not an IP) can *inspect*
  containers and read env/logs, and in at least one case a **pull + recreate** through it
  worked. But the reliable path is Brandon hitting **Force Update** on the Unraid template
  (pulls the new ghcr image and recreates). Don't assume an edit is live until the image
  revision label flips.
- **Rule:** after pushing, the change is *code-ready*, not *deployed*. State the deploy gate
  explicitly ("live until Brandon Force-Updates to `<sha>`"). Verify live by reading the
  container's image revision label via phatt-claw, not by assuming.

### New Prisma model? It needs `prisma db push` on boot
- **Cause:** new models (`SourceState`, `SwissStandingsCache`, …) aren't in the live DB
  until the schema is pushed. The image `CMD` (`Dockerfile:74`) runs `prisma db push` on
  boot, so the new image self-heals — but a container still on the *old* image (not yet
  Force-Updated) will 500 on the new table.
- **Rule:** ship schema changes knowing first boot must `prisma db push`. Confirm the new
  table exists before declaring a feature live.

### SQLite must live on a real disk, not a FUSE share
- **Cause:** SQLite WAL locking breaks on Unraid `/mnt/user` FUSE shares → corruption / locks.
- **Rule:** `DATABASE_URL` points at a cache/appdata **bind**, never `/mnt/user/...`.

### The workspace can't resolve the public hostname
- **Cause:** `pickems.phatt.vip` doesn't resolve from inside the dev container.
- **Rule:** reach the live app by container name on the phattvip network
  (`http://phatt-picks:3000`) or its phattvip IP, not the public URL.

---

## iOS / WebKit (no engine in the workspace — these are code-reviewed, not reproduced)

### A letter vanishes inside a gradient/foil wordmark ("HOT INE")
- **Cause:** `background-clip: text` does **not** paint `display: inline-block` descendants
  on WebKit (Chromium leaks the clip, so desktop looked fine and hid the bug).
- **Rule:** never put an `inline-block` child inside a `background-clip: text` element.
  Keep clipped text spans `inline`.

### A drawer/modal is clipped behind the bottom nav on mobile
- **Cause:** stacking-context trap. The drawer lived inside `main.shell` (`z-index:3`); its
  backdrop (`z-index:200`) was still trapped *below* the root `.botnav` (`z-index:50`)
  because the parent's context capped it.
- **Rule:** portal full-screen modals to `document.body` (escape the parent stacking
  context) and add safe-area padding. z-index inside a trapped context can't climb out.

### Can't reproduce an iOS bug locally
- **Rule:** there is no WebKit engine in the workspace. iOS-only bugs are reasoned about
  from the CSS/DOM and code-reviewed; the UI should self-report failure reasons where it can
  (e.g. the push toggle surfaces the concrete error instead of swallowing it).

### Sign-out (and other POSTs) 403 on iOS WebKit — the CSRF origin guard
- **Cause:** the CSRF same-origin guard (`isSameOrigin` in `src/lib/csrf.ts`) checks `Origin`/`Referer`.
  iOS Safari/Brave send **neither** on a same-origin form POST, so a strict guard 403s real users
  (PHA-1225). Second trap: SWAG terminates TLS, so the inbound `x-forwarded-host` is **https** while
  the internal `NEXTAUTH_URL` may be **http** — comparing against the wrong scheme also 403s.
- **Rule:** the guard **fails open** when both `Origin` and `Referer` are absent (no header = can't be a
  cross-site form), and it accepts the forwarded-host origin via `hostOriginVariants()` (both schemes),
  not just `NEXTAUTH_URL`. Mutating routes call `isSameOrigin` — keep that helper as the single source.

---

## crawl4ai / HLTV scraping

### Direct HLTV fetch returns 403
- **Cause:** Cloudflare. HLTV blocks plain server fetches.
- **Rule:** go through `crawl4ai:11235` with `crawler_config: { cache_mode: "BYPASS" }`.
  It's reachable in prod exactly as in the workspace (phattvip network, by container name).

### Map scores are missing from the scraped Swiss data
- **Cause:** crawl4ai's **markdown** rendering drops the per-match scores. They live in the
  page HTML attribute `data-match-details-popup-json`.
- **Rule:** for scores/match detail, parse the **HTML**, not the markdown. Lift the popup JSON.

### Live bracket renders blank on a freshly deployed container
- **Cause:** the standings cache is filled **on-read** from the gated `/picks` page, so a
  cold container is empty until someone loads it inside a match window.
- **Rule:** after a deploy during a live stage, warm it:
  `GET http://phatt-picks:3000/api/standings/refresh` (unauth-safe, crawls synchronously).

---

## browserless (screenshots / verification only)

- Reach it by **container IP/name, not `localhost`**.
- `/function` runs **CommonJS** — use `module.exports`, not ESM.
- Use `waitUntil: "load"`; screenshots come back **base64**.
- For a settled screenshot of an animated page, **emulate `prefers-reduced-motion`** so the
  intro animation doesn't render mid-frame.

---

## Client performance & the service worker

The Cologne live window surfaced a cluster of "the app froze my phone / I had to restart my
computer" reports. They were **four different causes** wearing the same costume — and the most
important lesson is that a whole-browser freeze is almost never the JS heap.

### "Freezes the WHOLE browser / had to restart" = GPU compositor, not JS heap (PHA-1269)
- **Cause:** full-viewport `backdrop-filter: blur()` (the Stage Wrapped backdrop that auto-opened on
  login, plus ambient `blur(140px)` and a `blur(20px)` bottom-nav). The GPU re-blurs the entire
  screen every animated frame → the whole browser stutters/freezes, not just the tab. It is
  **invisible to `performance.memory`** (that only sees the JS heap), so it never shows up in a
  heap probe and **does not reproduce headless** (headless Chrome defaults to
  `prefers-reduced-motion: reduce`).
- **Rule:** "freezes the whole browser / restart the computer / can't reproduce headless" ⇒ suspect
  **GPU/compositor** (blur, large filters, big composited layers), not JS memory. Profile with the
  GPU/rendering tools, and emulate `prefers-reduced-motion: no-preference`
  (`Emulation.setEmulatedMedia`) to reproduce. Avoid full-viewport `backdrop-filter` entirely.

### A stale cached build white-screens or freezes on old CSS — the service worker is the fix (PHA-1269)
- **Cause:** an installed PWA / cached client held onto a stale build (old CSS, or a `ChunkLoadError`
  when a hashed chunk 404s after a deploy). The user is stuck on broken old assets.
- **Rule:** `public/sw.js` is the recovery vector. On activate it `skipWaiting()`s, **purges all
  Cache Storage**, and broadcast-reloads every open client onto the fresh build. An inline
  self-heal in `layout.tsx` (sessionStorage loop-guard) drops the SW + caches and hard-reloads on a
  ChunkLoadError. `/sw.js` is served **uncacheable** (`Cache-Control: no-store`) so the recovery
  worker itself can always update. Keep the SW **cache-light** — it must not cache app content and
  must not interpose on SSE / API / streaming requests (or it holds the stream buffer).

### Eager `<Link>` prefetch storm froze the Android home page (PHA-1269)
- **Cause:** too many in-viewport `next/link` prefetches firing at once on first paint.
- **Rule:** disable prefetch on dense link lists (`prefetch={false}`) on the heavy landing surfaces.

### `router.refresh()` grows retained client memory on live views (PHA-1268)
- **Cause:** the AutoRefresh poll on live-results views calls `router.refresh()`; retained heap
  creeps up (~43% over 200 refreshes) even though the DOM stays flat.
- **Rule:** bound it — on results-only views, do a hard-reload reclaim (`reclaimSafe`) periodically,
  and **pause the refresh / SSE while the tab is hidden** (PHA-1267). Stop AutoRefresh entirely
  once the Major is over (PHA-1261).

### Immortal SSE poll-loops pin server CPU (PHA-1244)
- **Cause:** the notification SSE stream's poll loop only exited on `req.signal.aborted`; an enqueue
  throw to a gone peer was swallowed as a "DB hiccup", so each dropped connection left a loop running
  forever (5 DB queries / 8s, accumulating over hours = "MASSIVE cpu after update").
- **Rule:** an SSE handler needs a hard exit: a `cancel` flag, a `safeEnqueue` that **breaks** on
  throw (peer gone), and a lifetime cap (10 min). Never swallow an enqueue failure as transient.

### A bottom-sheet sized in `vh` sits partly off-screen on mobile (PHA-1276)
- **Cause:** `vh` counts the area *behind* a mobile browser's dynamic URL/nav bars, so a fixed-height
  bottom-sheet (the recap deck) pushed its top controls off-screen and clipped tall slides on Android
  Chrome.
- **Rule:** size mobile bottom-sheet modals in **`dvh`** (dynamic viewport height) with a `vh`
  fallback, cap with `max-height`, and let the inner stage scroll (`overflow:auto` + `margin:auto`
  to center when it fits).

---

## Valve / Steam API

### Synced picks come back as placeholders / sync 500s on re-upload
- **Cause:** `GetTournamentPredictions` returns the field **`pick`**, not `pickid`, and
  **omits `sectionid`**. Treat every row as a placeholder and you re-upload everything →
  slot-conflict 500s.
- **Rule:** read `p.pick ?? p.pickid`, rebuild `sectionid` from the group map, and
  **read-before-write / skip-unchanged**. `UploadTournamentPredictions` has **no batch
  format** — one call per slot/stage.

### SteamID64s look truncated or mismatched
- **Cause:** they're 64-bit — JS number precision mangles them.
- **Rule:** handle SteamID64 as **strings** end to end (`src/lib/bigint.ts`).

---

## Env / config

### A feature silently does nothing after the env var is set
- **Cause (1):** Unraid template values can be **quote-wrapped**. `VAPID_PUBLIC_KEY`
  arrived wrapped in quotes → browser `atob()` choked → `subscribe()` threw → a `catch`
  swallowed it. **Cause (2):** the var was set under a **misspelled name**
  (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` must match exactly). **Cause (3):** `OWNER_STEAM_ID`
  unset → owner-only tools **fail closed** and become invisible.
- **Rule:** strip quotes and **validate** env on read; surface a concrete reason instead of
  a swallowed `catch`; double-check the exact var name; remember owner gates fail closed.

---

## Git & workflow

### Concurrent runs clobber each other's checkout
- **Cause:** parallel sessions share the same HEAD/worktree. A `checkout` / `git add -A` in
  one stomps the other; local branch refs get clobbered.
- **Rule:** build each task in an **isolated worktree** (`git worktree add`), or commit via
  **plumbing** (`commit-tree` + a temp `GIT_INDEX_FILE`) — never `checkout` / `add -A` on the
  shared tree. Commit **before** removing a worktree.

### `origin/main` moved under me; my "revert" reverted nothing real
- **Cause:** a human merged PRs live while I worked off a stale base. Diffs against the stale
  base looked like reverts that weren't.
- **Rule:** **re-fetch `origin/main`** before integrating. Confirm with per-commit
  `git show --stat`. Rebase onto the real main; don't hand-author "reverts" from a stale diff.
  (This repo's `main` checkout is often dozens of commits behind `origin/main` — always
  branch off `origin/main`, not local `main`.)

### Commit authorship
- **Rule:** commits are authored as **@phattbeats only — no co-authors**, no Claude/Paperclip
  trailers. This overrides the default harness co-author trailer.

---

## TypeScript / build

- **`s` (dotall) regex flag fails to compile** → the TS target is below es2018. Use
  `[\s\S]` instead of `.` with the `s` flag, or raise the target.
- **`output: standalone`** — the production image is the standalone bundle; don't assume
  `node_modules` is present at runtime the way it is in dev.
- **Dev tooling:** `NODE_ENV=production` prunes dev deps; the npm cache can be root-owned.
  Install with `NODE_ENV=development ... --cache "$(pwd)/.npm-cache"`. Turbopack rejects an
  external `node_modules` symlink — use `cp -al` on the same filesystem.

---

## Product logic

### A schedule lock has THREE surfaces
- **Cause:** locking the picker UI but not the write-guard, or not the reveal/compare gate,
  leaks picks. Each is independent.
- **Rule:** a stage lock must hit **all three**: the picker (`/picks`), the write-guard
  (`POST /api/picks` → 409), and the reveal/compare gate (`reveal-core`). `locked = can't
  PICK`, **not** `can't VIEW` — keep tabs to locked stages clickable.

### Consensus / "lone pick" reads as broken at small N
- **Cause:** at N=5 every share rounds to a multiple of 20%; "X% of field" jargon looked
  like a bug. And per-*exact-slot* consensus mislabels interchangeable Swiss bucket slots
  (everyone's 0-3 pick showed as a "lone pick").
- **Rule:** prefer **raw counts** ("3 of 5 picked") — honest at any N. Compute Swiss
  consensus at **bucket grain** (slots in a bucket are interchangeable), denominator =
  distinct players. Hide the line when the field is < 2.

### A reaction silently overwrites someone else's — the shared-group unique key (PHA-1262)
- **Cause:** the `Reaction` `@@unique` omitted `targetPlayerId`. Playoff bracket groups are shared
  across all players (everyone picks into the same QF/SF/GF slots), so reacting to a *second* player
  at the same `(eventId,sectionId,groupId,slotIndex)` collided with and silently re-stamped the
  *first* target. The symptom ("I can only react to one person on the bracket") looked like a UI bug.
- **Rule:** any per-target reaction/vote table must include the **target** in its uniqueness key.
  The Cologne key is `@@unique([senderId,eventId,sectionId,groupId,slotIndex,targetPlayerId])`.
  Reproduce end-to-end (mint a session, POST the live API for two targets) before theorizing about
  the gate.

### The live entry gate keys on `phatt_session` only
- **Cause:** on the live container the splash/entry middleware gates on `phatt_session`
  alone — the `hotline_entered` cookie bypass present in dev is not the live behavior.
- **Rule:** to review a session-gated page on live, **mint a session JWT** (read
  `NEXTAUTH_SECRET` from the container env) rather than relying on the cookie bypass.

### Playoff (and off-roster Swiss) winners never turn green — the seed-swap / off-roster rejection class
This is the single most-repeated outcome bug in this repo: a match clearly finished, the
source clearly has the winner, but the bracket/leaderboard never scores it. It bit Swiss as
**PHA-1109** and the playoffs as **PHA-1273** (Cologne QF1/QF2 sat unresolved while QF3/QF4
resolved — "temporally backwards", which is the tell that it's the validator, not the clock).

**How outcome resolution actually works.** A `StageOutcome` row is written only after
`normalizeOutcomes` (`src/lib/outcomes-core.ts`) accepts a candidate winner. There are three
sources, and they are **not** validated the same way:
- **`hltv`** (Swiss bridge) and **`valve`** (playoff answer key) read the winner from the
  **live** tournament structure, so the winner is by construction a real, current team. Both
  validate against the **global** event roster (`layout.teams`) — `trustsLiveField`.
- **`liquipedia`** keeps the strict **per-group** check: its parse is name-matched and it
  can't know Valve's live slot/seed order, so an out-of-group team really is a parse error.

**Why the strict per-group check is wrong for live sources.** The committed per-group roster
in the fixture is only a **pre-seed guess**. Two ways it legitimately drifts from reality:
- *Swiss (PHA-1109):* the pick'em group carries 8 teams but the live Swiss runs 16, so a real
  clinch by an "off-roster" team (B8 0:3 / Spirit 3:0) was rejected "not eligible for group".
- *Playoffs (PHA-1273):* the bracket is **dynamically seeded**. Cologne's fixture seeded
  groups 274/275 as Aurora–BetBoom / 9z–FURIA, but Valve's real bracket had them **swapped**
  (274 = 9z–FURIA → FURIA 85, 275 = Aurora–BetBoom → Aurora 134). The picks UI overlays
  Valve's live teams (`mergeLiveLayout` by `sectionid:groupid`), so players picked into
  Valve's arrangement — yet the per-group check validated against the stale committed roster
  and rejected 85/134 forever.
- **Rule:** for `source=hltv`/`valve` validate against the **global** field, not the committed
  per-group roster. Do **not** "fix" a missing playoff winner by editing the fixture seeds to
  match Valve — the dynamic seed is Valve's to own; trust the live layout instead.

**Who pokes the oracle (headless).** Swiss outcomes resolve from the on-read
`/api/standings/refresh` warm (`bridgeSwissOutcomes`). **Playoff** outcomes come **only** from
the Valve answer key (`ingestOutcomes` → `GetTournamentLayout`), which historically ran only on
the owner's manual `POST /api/outcomes/ingest` or an unreliable `after()`-deferred read path —
so nothing headless poked it after the owner's last run. **PHA-1273** wired `ingestOutcomes`
into `refreshLiveResultsTick` (`src/lib/outcomes.ts`), the same traffic-independent in-process
tick that resolves Swiss clinches. It's idempotent and self-gating (only locked groups with a
single resolved pickid; already-resolved slots filtered before persist), so QF/SF/GF now turn
green within a tick without any owner action. If a future major's playoffs still don't resolve,
check that tick is wired and that the bracket sections are reachable by `ingestOutcomes`.

**The stale-outcome watchdog.** That headless retry runs every tick, which is exactly what
*masked* QF1/QF2 for ~2 days — a blind retry that never noticed it was stuck. So the tick also
runs `detectStalePlayoffOutcomes` (`outcomes-core.ts`) after the retry: per playoff section it
reconciles the **count** of games whose scheduled start + `PLAYOFF_RESOLVE_GRACE_MS` (6h) has
elapsed against the number of distinct resolved groups, and logs a structured
`[live-tick] STALE playoff outcomes …` warning (and a `stale` count on the tick) when a match is
overdue. It is **count-based and seed-order-independent on purpose** — it never maps a schedule
slot to a specific group (that mapping is the very seed assumption that broke QF1/QF2), so it
catches a stuck match no matter which group it is, and never false-fires on a game still in
progress. The grace is the *detection* deadline, not a retry interval. If you see that warning,
a real match is genuinely stuck — check the source and the `rejected` summary from `ingestOutcomes`.
