# HOTLINE — Admin & Operator Guide

*The operator's handbook. What HOTLINE needs to run, how it's wired together, what each moving part does, and how to fix it when something breaks. Written to be read top to bottom by the person who runs the app — more technical than the [user-facing EXPLAINER](EXPLAINER.md), but practical, not deep-internals.*

> **How this fits with the other docs.** This guide is the single front-to-back operator's read. It deliberately *summarizes and links* rather than duplicates:
> - **[OPERATIONS.md](OPERATIONS.md)** — the exhaustive reference: every env var, every HTTP route, smoke checks.
> - **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the code fits together, the data-flow diagram, the `-core` pattern.
> - **[GOTCHAS.md](GOTCHAS.md)** — the war stories behind the troubleshooting playbook below.
> - **[NEXT-MAJOR.md](NEXT-MAJOR.md)** + **[PRE-MAJOR-CHECKLIST.md](PRE-MAJOR-CHECKLIST.md)** — standing up the next tournament.
>
> When a number or symbol here disagrees with one of those, **they win** — they sit next to the code.

---

## Table of contents

1. [The 60-second mental model](#1-the-60-second-mental-model)
2. [Requirements](#2-requirements)
3. [Infrastructure & topology](#3-infrastructure--topology)
4. [The components, explained](#4-the-components-explained)
5. [Deploying & updating](#5-deploying--updating)
6. [Configuration & secrets](#6-configuration--secrets)
7. [Troubleshooting playbook](#7-troubleshooting-playbook)
8. [Routine operations](#8-routine-operations)
9. [Standing up the next Major](#9-standing-up-the-next-major)

---

## 1. The 60-second mental model

HOTLINE is **one self-contained web app** in **one Docker container**. There is no separate database server, no job queue, no microservices.

```
                         Internet
                            │
                            ▼
                   SWAG (reverse proxy, TLS)
                pickems.phatt.vip → :3000
                            │
        ┌───────────────────┴───────────────────┐
        │      phatt-picks container (Next.js)   │
        │   ┌──────────────────────────────────┐ │
        │   │ app + in-process scheduler        │ │
        │   └──────────────────────────────────┘ │
        │            │                            │
        │            ▼                            │
        │   SQLite file on /data  (the DB)        │
        └───────────────────┬─────────────────────┘
                            │  (phattvip network, by container name)
            ┌───────────────┼────────────────┐
            ▼               ▼                 ▼
        crawl4ai       Steam Web API      Liquipedia
      (live HLTV,     (the answer key,    (match outcomes)
       optional)       Steam login/sync)
```

Everything the app *remembers* (players, picks, scores, coins, reactions, push subscriptions) lives in a single **SQLite file on disk**. Everything it *learns from the outside world* (results, live standings, odds) is fetched on demand and cached. Restart the container and nothing is lost because the DB file is on a bind mount.

---

## 2. Requirements

### Hard requirements — the app won't run, or core features break, without these

| Requirement | Why |
|---|---|
| **A SQLite path on real disk** (`DATABASE_URL`) | The app's entire memory. **Must be a cache/appdata bind, never a FUSE `/mnt/user` share** — SQLite's WAL locking corrupts on FUSE. |
| **Public origin** (`NEXTAUTH_URL`) | Must match the SWAG host exactly (`https://pickems.phatt.vip`), or Steam login and invite links break. |
| **Session secret** (`NEXTAUTH_SECRET`) | Signs the login cookie. **Must be a fixed value in the Unraid template** — see the warning in §6. |
| **Steam Web API key** (`STEAM_API_KEY`) | Needed for Steam login, reading Valve picks, and the answer key. |
| **Auth-code encryption key** (`AUTH_CODE_ENCRYPTION_KEY`) | 32-byte hex; encrypts each user's Steam Pick'Em code at rest. |
| **The `phattvip` Docker network + SWAG** | The network lets the container reach shared services by name; SWAG gives it a secure public address on port 3000. |

### Optional — the app runs fine without them; each just gates one feature

| Thing | Gates |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push notifications. Missing → the UI hides the opt-in. |
| `WRITE_ENABLED` | Pushing picks **up to Valve** (destructive; default off). |
| `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | The signup CAPTCHA. Missing → CAPTCHA skipped. |
| `OWNER_STEAM_ID` | Unlocks the owner-only admin tools (local-player cleanup, the `/admin/analytics` dashboard, and the manual news/outcomes ingest routes). Unset → owner gate fails closed (nobody is owner). |
| `CRAWL4AI_URL` | The crawl4ai endpoint (see below). |

Full var-by-var table with exact behaviors: **[OPERATIONS.md → Environment variables](OPERATIONS.md#environment-variables)**.

### Shared services on the network

- **`crawl4ai:11235` — a *soft*, graceful-degrade dependency.** It fetches HLTV pages (which 403 a direct fetch behind Cloudflare). It powers **only** two features: the *live* mid-stage Swiss standings/bracket, and the team "Last 5" form panels. If crawl4ai is unreachable, **those two go empty/stale (logged, no crash)** and everything else — login, picks, scoring, leaderboard, reveals, recaps, reactions, notifications — keeps working. **It is not required to run the app.**
- **`browserless:3000` — not a runtime dependency at all.** Real Chrome, used only for screenshots/verification tooling during development. The deployed app never calls it.

So: is crawl4ai "a requirement of the container"? **No** — it's an optional enhancement for live data. The container's actual hard needs are the six rows in the table above.

---

## 3. Infrastructure & topology

- **Host.** The container runs on the **Unraid server (PHATT-RAID)**, managed from its Unraid template.
- **Image.** Published to **`ghcr.io/phattbeats/phatt-picks`**. Tags: `:latest` tracks `main`; `:vX.Y.Z` is a pinnable release; `:X.Y` is the latest patch in a minor line. Cutting a release = push a `vX.Y.Z` git tag and CI publishes the images.
- **Build.** A Next.js App-Router + TypeScript app, built as a **standalone** bundle (`output: standalone`) — the production image carries only what it needs, so don't assume a full `node_modules` at runtime.
- **Network.** Joins the external **`phattvip`** Docker network. Services talk **by container name** (`http://phatt-picks:3000`, `http://crawl4ai:11235`) — there's no internal DNS for the public `pickems.phatt.vip` name, so from inside the network you reach the app by container name/IP, not the public URL.
- **Reverse proxy.** **SWAG** terminates TLS and proxies `pickems.phatt.vip` → the container's port 3000. SWAG being the TLS terminator matters for one subtle bug (the inbound forwarded host is `https` while the internal URL may be `http`) — see the iPhone-403 entry in the troubleshooting playbook.
- **Storage.** The SQLite DB lives on a **non-FUSE appdata/cache bind** mounted at `/data` inside the container. This bind is the backup unit — copy the file and you've backed up everything.
- **Health.** The container has a Docker healthcheck hitting `GET /api/health`, which returns `{status, db}`.
- **Schema migration.** The image's start command runs `prisma db push` on boot, so a fresh DB self-creates its tables and a new data model "just works" once the new image boots. (Corollary: a container still on the *old* image will 500 on a brand-new table until it's updated.)
- **The scheduler is in-process.** Pre-lock reminders and the live-results tick run **inside the container** on a ~5-minute timer (`src/instrumentation.ts`) — there is **no external cron or sidecar**. One container is the whole system.

---

## 4. The components, explained

Each subsystem, what it does, and where it can fail. For the code-level data-flow diagram, see [ARCHITECTURE.md](ARCHITECTURE.md).

### Authentication & sessions
- **Two ways in:** Steam (OpenID 2.0 → upserts a player, issues a `phatt_session` cookie) and local/guest (no Steam). Local players can also get a cross-device login token to sign in elsewhere without Steam, and can later merge their guest picks onto a Steam account.
- **The session cookie** (`phatt_session`) is a signed JWT, valid 30 days, *sliding* (re-stamped past the halfway mark so active users never get logged out). It's signed by `NEXTAUTH_SECRET` — change that secret and **every** existing cookie becomes invalid (mass logout).
- **The entry gate** (middleware) sends un-signed-in visitors to the splash/login. On the live container it keys on the `phatt_session` cookie alone.

### Picks
- The **Picks** page shows Swiss stages as **three buckets** (3–0 / advances / 0–3) or the **single interactive playoff bracket** (tap a winner, they advance QF→SF→GF).
- A pick is writable only if the stage is **pickable** *and* **not past its lock time**. A lock has **three independent surfaces** — the picker UI, the write-guard (`POST /api/picks` → 409), and the reveal/compare gate. All three must agree or picks leak (this has bitten before).

### Steam mirror (read + write)
- **Read** (`/api/picks/sync`) pulls the player's live Valve predictions and mirrors them in.
- **Write** (`/api/picks/sync-stage`) pushes HOTLINE picks up to Valve. It's **destructive** (overwrites the user's live Valve picks) and gated by `WRITE_ENABLED`, which defaults **off**. Leave it off unless you deliberately want real write-back.

### Outcomes & scoring — "the answer key"
This is the part most worth understanding, because it's where "a match finished but nobody scored" bugs live.
- **The Valve oracle is the source of truth** once Valve seeds the official bracket layout: the app reads Valve's winning pick IDs and writes `StageOutcome` rows.
- **Scoring** compares each player's picks to those `StageOutcome` rows, using **Valve's own per-stage weighting** read from the layout (Swiss 1/2/3 pts per pick in Stages I/II/III; playoffs 12/10/7 per QF/SF/GF match; flat within a stage — no upset bonus), at **bucket grain** for Swiss (right bucket = correct, exact slot doesn't matter).
- **The live HLTV bridge** fills a gap: Valve publishes no win-loss mid-stage, so the app scores live 3-0/0-3 Swiss clinches from HLTV *before* Valve seeds the key.
- **Liquipedia is a polite fallback** outcome source (≤1 request/30s, CC-BY-SA attribution required) for locked-but-unresolved stages where Valve hasn't yet exposed a result. HLTV and Valve sources validate winners against the *global* live field; Liquipedia keeps a stricter per-group check.
- **Headless resolution.** Both the Swiss bridge and the Valve playoff answer key are poked by the in-process **live-results tick** (every ~5 min), so outcomes turn green without anyone loading a page or the owner running anything. There's also a **stale-outcome watchdog** that logs a loud `[live-tick] STALE playoff outcomes …` warning if a match is overdue — if you see that, a real match is genuinely stuck (see playbook).

### Live boards (crawl4ai)
- Live Swiss standings/bracket and team "Last 5" dossiers come from **HLTV via crawl4ai**, cached in the DB (`SwissStandingsCache`, `TeamStatsCache`).
- These are **filled on-read** within a refresh window and rate-limited (~1 crawl/hour per source). A **cold container is empty** until someone loads the page or you warm it (see Routine operations).
- **Display-only** — these boards don't feed scoring (except via the live Swiss bridge above).

### Notifications & the scheduler
- **Five notification kinds** flow through one inbox: `stage` (pre-lock reminders, 24h + 1h before a stage locks), `reaction` (a Bleachers stamp landed on your pick), `recap` (your Stage Wrapped is ready), `coin` (you earned a Challenge Coin), and `announcement` (an owner broadcast). There's an in-app inbox (the bell) with an unread badge, mark-read / mark-all-read, and an unread filter. Each kind has independent in-app and push toggles in the user's prefs.
- **Web Push** mirrors all five kinds to the OS (gated by the `VAPID_*` keys; see §2). On iPhone, push only fires after the user installs the PWA to the home screen.
- The **in-process scheduler** (~5-min tick, `src/instrumentation.ts`) runs **four push jobs** — pre-lock reminders, recap pushes, announcement pushes, and coin-earned pushes — alongside the separate **live-results tick** on the same timer. It's **on by default**; set `PRELOCK_REMINDERS_DISABLED=1` to turn the reminder side off. Cutoffs come from the committed lock schedule unless overridden. (Playoff QF/SF/GF collapse into one "Playoffs" cutoff, since the bracket is a single Pick'Em.)
- **Real-time delivery** is a Server-Sent-Events stream (`GET /api/notifications/stream`) that drives the live badge and toasts. It is deliberately **self-limiting** — it polls the feed every ~30s, sends a keepalive every ~25s, and hard-recycles each connection at a **10-minute lifetime cap** so a dropped client can't leave an immortal loop (the PHA-1244 CPU-leak fix). Per-connection churn in the logs is normal, not a leak.

### The database
- One **SQLite** file. Tables for players, picks, outcomes, the various caches, push subscriptions, reactions, coins, analytics page-views, etc.
- Migrations are automatic on boot (`prisma db push`). To inspect or repair live data, run a throwaway container with Prisma pointed at a copy of the file (the live container's shell is typically locked down).

### Caches & refresh routes
Several `/api/*/refresh` routes (`standings`, `team-stats`, `odds`) **synchronously warm** a cache. They take **no user input** (no SSRF — they only hit a hard-coded registry), write only public caches, and are rate-limited (~1 crawl/hour per source via an atomic `SourceState` claim). They're safe to hit anytime; you mostly use them to warm a freshly deployed container during a live stage.

### Analytics (built-in, privacy-first)
HOTLINE ships its **own** lightweight traffic analytics — there is **no Umami, Plausible, or third-party tag**, and no extra container. It's all in the one app.
- **Collection:** a tiny inline tracker posts page views (and a few custom events) to `POST /api/stats/collect`. The endpoint is same-origin only, honours Do-Not-Track, is body-size-capped and per-IP rate-limited.
- **What's stored:** the `PageView` table holds path, device/browser/OS class, and country (from the `cf-ipcountry` header) — **no raw IP, no user id, no query strings, no cookies.** Repeat-visitor counting uses a **daily-rotating salted hash** of IP+UA that can't be reversed and resets every day. Privacy-by-construction.
- **Dashboard:** the owner views it at **`/admin/analytics`** (gated by `OWNER_STEAM_ID`). It needs no configuration — it's on as soon as the app runs.

---

## 5. Deploying & updating

**The reliable deploy path is Brandon hitting "Force Update" on the Unraid template** — it pulls the new ghcr image and recreates the container. (The `phatt-claw` Docker socket proxy can inspect containers and in some cases pull+recreate, but treat Force Update as the canonical path.)

**Deploy discipline:**
1. Pushing code makes it **code-ready, not deployed.** Nothing is live until the image is pulled and the container recreated.
2. After Force Update, **verify the running image revision** (its label/sha) — don't assume the new code is live.
3. **First boot self-migrates** the DB (`prisma db push`), so new data models work once the new image boots. A container still on the old image will 500 on a brand-new table.
4. **Warm caches if deploying mid-stage** (see Routine operations) so live standings/dossiers aren't blank for the first visitor.

**Releases & rollback.** Pin to a `:vX.Y.Z` tag to roll back to a known-good build; `:latest` always tracks `main`.

---

## 6. Configuration & secrets

All config is environment variables on the Unraid template. The complete table is in [OPERATIONS.md](OPERATIONS.md#environment-variables). The two you must handle carefully:

### `NEXTAUTH_SECRET` — the one that logs everyone out
- It signs every session cookie. **It must be a fixed value stored in the Unraid template**, not set ad-hoc on the running container.
- **Why it bites:** a Force Update recreates the container from the template. Any var that existed *only* on the running container (not in the template) is **dropped**. If `NEXTAUTH_SECRET` was ad-hoc, it effectively rotates → every existing `phatt_session` cookie fails verification → **the entire user base is logged out** on their next page load.
- The boot log prints `[session] NEXTAUTH_SECRET present …` when set, and a loud warning when missing/placeholder. Check the log after a deploy.

### `WRITE_ENABLED` — the destructive one
- `true` lets HOTLINE overwrite users' **live Valve picks**. Default `false`. Leave it off unless you specifically intend real write-back, and flip it back off afterward.

**General env gotcha:** Unraid template values can arrive **quote-wrapped**, and a **misspelled** public var name (e.g. `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) silently disables a feature with no error. If a feature "does nothing" after you set its var, suspect quotes or a typo'd name first.

---

## 7. Troubleshooting playbook

Symptom → likely cause → fix. The deeper war stories are in [GOTCHAS.md](GOTCHAS.md).

### "Everyone got logged out after an update"
- **Cause:** `NEXTAUTH_SECRET` rotated — almost always because it was set ad-hoc on the container instead of in the template, and a Force Update dropped it. (See §6.)
- **Fix:** set a fixed `NEXTAUTH_SECRET` in the Unraid template so it survives recreation. Users re-login once; it won't recur.

### "Live standings / playoff bracket are blank"
- **Cause:** the standings cache fills **on-read** and a freshly deployed (cold) container is empty until someone loads `/picks` inside a match window. Or crawl4ai is unreachable.
- **Fix:** warm it — `GET http://phatt-picks:3000/api/standings/refresh` (unauth-safe, crawls synchronously). If still blank, check crawl4ai is up on the network. Remember: blank live boards never break scoring or anything else.

### "A match clearly finished but it won't turn green / score"
- **Cause:** the most-repeated bug class in this app — the **seed-swap / off-roster rejection**. The validator rejected a real winner because the committed per-group roster guess drifted from Valve's live bracket (Swiss runs more teams than the pick'em group; playoff brackets are dynamically seeded and can be swapped vs. the committed fixture).
- **Tell:** outcomes resolving "temporally backwards" (later matches green, earlier ones stuck) points at the validator, not the clock. Look for a `[live-tick] STALE playoff outcomes …` warning.
- **Fix:** this is handled in code for live sources (they validate against the *global* field, and the live tick pokes the answer key every ~5 min). **Do not** "fix" it by editing the fixture seeds to match Valve — the live layout is the source of truth. If it recurs on a new Major, confirm the live-results tick is wired and the bracket sections are reachable by the ingest path. (Full detail: GOTCHAS → "Playoff winners never turn green".)

### "Sign-out or other actions 403 on iPhone"
- **Cause:** the CSRF same-origin guard. iOS Safari/Brave send **no** `Origin`/`Referer` on same-origin form POSTs; a strict guard 403s real users. Second trap: SWAG terminates TLS, so the forwarded host is `https` while the internal URL may be `http`.
- **Fix:** already handled — the guard fails open when both headers are absent and accepts the forwarded-host origin in both schemes. If you reintroduce a mutating route, route it through the shared `isSameOrigin` helper.

### "Push notifications don't work"
- **Causes, in order of likelihood:** (1) on **iPhone**, push only works after the user **installs the PWA to the home screen** and opens it from there — this is an Apple requirement, not a bug. (2) `VAPID_*` keys missing or **quote-wrapped** in the template. (3) User hasn't opted in.
- **Fix:** confirm the VAPID keys are set and unquoted (the boot log / `/api/push/public-key` returning a non-null key tells you). Have the iPhone user install to home screen, then opt in and use **Send a test reminder**.

### "Steam sync does nothing or 500s"
- **Causes:** `WRITE_ENABLED` is off (the pill says "Steam sync disabled by owner" — expected). Or the user hasn't pasted their Steam Pick'Em auth code (pill says "Add your Steam auth code to sync" → send them to `/help/auth-code`). Or a re-upload conflict from treating Valve's response rows as placeholders.
- **Fix:** set `WRITE_ENABLED=true` only if you want real write-back; otherwise the "disabled" pill is correct behavior, not a fault.

### "The app 500s right after an update"
- **Cause:** usually a **new data model** the old image didn't have, before the new image's boot `prisma db push` ran — or a half-applied update.
- **Fix:** confirm the new image actually booted (check the running image revision) and that boot logs show the schema push succeeded. Confirm the new table exists before declaring the feature live.

### "An image pull fails partway / weird disk errors"
- **Cause:** the **PHATT-RAID disk is full** — pulls can fail mid-layer (sometimes even while returning an HTTP 200), leaving a stale image.
- **Fix:** free space (prune unused images/containers), then re-pull and **verify the running revision** afterward.

### "I can't reach the app to debug it"
- **Cause:** `pickems.phatt.vip` doesn't resolve from inside the dev/agent container.
- **Fix:** reach the live app by **container name on the phattvip network** (`http://phatt-picks:3000`) or its phattvip IP — not the public URL. To view a session-gated page, mint a session JWT using the container's `NEXTAUTH_SECRET`.

---

## 8. Routine operations

```bash
# Is it healthy?
GET  http://phatt-picks:3000/api/health        → {"status":"ok","db":"ok"}

# Warm caches after a mid-stage deploy (all unauth-safe, no user input):
GET  http://phatt-picks:3000/api/standings/refresh   # live Swiss standings + resolve outcomes
GET  http://phatt-picks:3000/api/team-stats/refresh  # team "Last 5" dossiers
GET  http://phatt-picks:3000/api/odds/refresh        # playoff Spotlight odds (no-op until odds registry filled)
```

- **Check what's actually live:** read the running container's image revision label (via phatt-claw inspect) — don't assume a push is deployed.
- **Inspect/repair the DB:** run a throwaway container with Prisma against a copy of the `/data` SQLite file rather than poking the live container.
- **Back up:** copy the SQLite file off the `/data` bind. That single file is everything.
- **Watch the logs** for `[session] …` (secret presence), `[live-tick] …` (outcome resolution + stale warnings), and crawl errors.

---

## 9. Standing up the next Major

HOTLINE is built to re-point at each new Major by editing a handful of committed config seams (event ids, the team field, the stage schedule). **PGL Singapore 2026 is already seeded.** Don't do this by hand from memory — follow the runbook:

- **[NEXT-MAJOR.md](NEXT-MAJOR.md)** — the seam-by-seam runbook: every constant/fixture that changes per event, in order, with a checklist.
- **[PRE-MAJOR-CHECKLIST.md](PRE-MAJOR-CHECKLIST.md)** — the field guide for *gathering* the inputs (HLTV event ids, the 32-team field → pick ids, the per-stage stats-refresh routine).

Past Majors are archived, not deleted, so old leaderboards and players' Challenge Coins persist across events.

---

*Questions this guide doesn't answer live in the deep-reference docs linked at the top. Keep this guide true: when infrastructure, a requirement, or a troubleshooting fix changes, update the relevant section here in the same PR.*
