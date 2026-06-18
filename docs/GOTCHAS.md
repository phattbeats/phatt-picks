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

### The live entry gate keys on `phatt_session` only
- **Cause:** on the live container the splash/entry middleware gates on `phatt_session`
  alone — the `hotline_entered` cookie bypass present in dev is not the live behavior.
- **Rule:** to review a session-gated page on live, **mint a session JWT** (read
  `NEXTAUTH_SECRET` from the container env) rather than relying on the cookie bypass.
