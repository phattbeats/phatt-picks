# Architecture

How phaTT Picks fits together. Read this before changing picks, scoring, brackets,
or outcome resolution.

## Stack & topology

- **Next.js (App Router) + TypeScript**, `output: standalone`. One container.
- **Prisma + SQLite** on a `/data` bind mount (a real disk, never a FUSE `/mnt/user`
  share — WAL locking breaks on FUSE).
- Deploys to the **`phattvip` Docker network** behind **SWAG** at `pickems.phatt.vip`.
- Responsive **installable PWA** is the entire mobile story. No native apps.
- Two shared services on the same network, reachable **by container name**:
  - `crawl4ai:11235` — renders/bypasses Cloudflare for the live HLTV scrape.
  - `browserless:3000` — real Chrome, used for screenshots / verification only.

Deploy = Brandon **Force Update** on Unraid (pulls the new ghcr image and recreates).
The first boot of a fresh DB needs `npx prisma db push` (the `docker-entrypoint.sh`
handles schema; see OPERATIONS.md).

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
node --experimental-strip-types --no-warnings scripts/verify-swiss-results.ts
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
   OUTCOMES (two independent sources)
     1. Valve oracle  : fetchTournamentLayout → resolveOutcomesFromLayout   (the answer key)
     2. on-read driver: refreshOutcomesOnRead (atomic claim + after())  → StageOutcome rows
                         │
                         ▼
   SCORING  scoring.ts  ──►  /api/leaderboard   (bucket-aware weighting; picks hidden until lock)
                         │
                         ├─►  reveal-core  : picks stay hidden until the stage locks
                         │                   invariant: revealed === !writable
                         └─►  consensus-core: "lone pick" / bucket-share lines on compare + profile

   LIVE BOARDS (display only, do NOT feed scoring except via PHA-918 bridge)
     Swiss standings/bracket : HLTV event pages → crawl4ai → swiss-results(-core) → SwissStandingsCache
                               gated by isWithinMatchWindow (only crawl on match days)
     Playoff bracket         : committed layout (108/109/110) + StageOutcome, NO crawl; ??? until seeded
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
  computed by `swiss-bucket-core`. Playoffs render as bracket slots.
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
  response isn't blocked.
- `scoring.ts` scores picks against `StageOutcome` with **bucket-aware** weighting (a Swiss
  bucket pick is right if the team landed in that bucket, not a single exact slot).

### Live boards (HLTV)
- Valve has **no W-L** mid-stage, so the live Swiss standings/bracket come from **HLTV event
  pages**, fetched through **crawl4ai** (direct fetch is 403 Cloudflare). `swiss-results.ts`
  claims an ~hourly refresh slot, crawls, and persists a `SwissStandingsCache` JSON blob;
  `swiss-results-core` parses it. Map scores live in HLTV's `data-match-details-popup-json`
  (the markdown rendering drops them — read the HTML).
- The crawl is **gated by `isWithinMatchWindow`** so it only runs on days games are played.
- The **playoff bracket** needs no crawl: its tree comes from the committed layout and fills
  from `StageOutcome`. It honestly shows `???` until Stage 3 seeds the quarterfinals.

### Reveal / compare
- `reveal-core` keeps a player's picks hidden until the stage locks. Core invariant:
  `revealed === !writable`. The compare page and `players/[id]` both pass through it.

## Where the per-major seams are

Everything that changes for the *next* Major is committed config, not fetched. The
full list and the order to change it is in **[NEXT-MAJOR.md](NEXT-MAJOR.md)**. The
short version:

- `lock-schedule-core.ts` — `COLOGNE_LOCK_SCHEDULE` (section → lock instant) + `COLOGNE_MATCH_WINDOWS`.
- `swiss-results.ts` — `SECTION_SOURCES` (section → HLTV event URL).
- Team / pickid / region / logo / stats maps — one file each, keyed by Valve pickid.
- The committed bracket layout (sections 105–110).
