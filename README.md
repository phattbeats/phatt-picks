# HOTLINE

A CS2 Major Pick'Em companion for a small private group, targeting **IEM Cologne 2026**
(June 2–21). Members log in with Steam (or play locally — no Steam needed), set/mirror their
picks, and compete on a shared leaderboard scored on Valve's own weighting. Built generically so
it can be re-pointed at future Majors.

Next.js (App Router) + TypeScript + Prisma/SQLite. Deploys as a single container on the
`phattvip` network behind SWAG at `pickems.phatt.vip`. The responsive **installable PWA** is the
entire mobile story (no native apps).

> **📚 Knowledge base → [`docs/`](docs/README.md)** — architecture, the
> [next-Major runbook](docs/NEXT-MAJOR.md), [operations](docs/OPERATIONS.md), and
> [hard-won gotchas](docs/GOTCHAS.md). Start there before changing the system or
> standing up a new Major. **Keep it true: update the relevant doc in the same PR.**

## What's inside

- **Per-stage picks** — Swiss stages as 2 / 6 / 2 buckets, plus **one interactive QF→SF→GF
  playoff bracket** you place at once (tap a winner, they advance).
- **Steam mirror** — pull your live Valve Pick'Em and (optionally) push locally-set picks back up.
- **Shared leaderboard** — scored on Valve's own weighting; picks hidden until each stage locks.
- **Stage Reveal & Wrapped** — per-stage reveal boards and a click-through "Stage Wrapped" recap.
- **Playoff Spotlight** — per-team narrative + highlight, with live Polymarket implied odds.
- **PWA + Web Push** — installable, with opt-in 24h/1h pre-lock reminders.
- **Multi-Major by design** — an event registry + clock-derived lifecycle re-points the app at the
  next Major from committed config (PGL Singapore 2026 is already seeded).

## Getting started (local dev)

```bash
NODE_ENV=development npm install --include=dev --cache "$(pwd)/.npm-cache"
DATABASE_URL="file:./dev.db" npx prisma generate
DATABASE_URL="file:./dev.db" npx prisma db push
npm run dev   # http://localhost:3000
```

A gitignored dev `.env` (SQLite + dummy secrets) is already in the repo root.

## Environment variables

See `.env.example`. Summary:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | SQLite path — use an absolute appdata path in prod (not a FUSE share). |
| `NEXTAUTH_URL` | Public base URL (`https://pickems.phatt.vip`). Used for OpenID return + invite links. |
| `NEXTAUTH_SECRET` | Session-JWT signing secret. `openssl rand -base64 32`. |
| `STEAM_API_KEY` | One app key, server-side only, never sent to the client. |
| `AUTH_CODE_ENCRYPTION_KEY` | 32-byte hex; encrypts per-user Valve auth codes at rest. |
| `WRITE_ENABLED` | `"true"` enables the stage-batched write-back to Valve (**destructive** — overwrites the owner's live picks). Defaults `false`; leave off for the first tournament run, flip on only for deploy-smoke. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keypair. Generate: `npx web-push generate-vapid-keys`. |
| `VAPID_SUBJECT` | `mailto:` contact for push. |
| `PRELOCK_REMINDERS_DISABLED` | (optional) `1`/`true` turns OFF the in-process pre-lock reminder scheduler. It is **ON by default** (PHA-996) with no env required. |
| `STAGE_LOCKS_JSON` | (optional) **override** for the reminder cutoffs; defaults to the committed `COLOGNE_LOCK_SCHEDULE` when unset. |

## PWA install & push reminders

HOTLINE is an installable PWA (`public/manifest.json` + `public/sw.js`). Installing is
**required for push on iOS** — opt-in pre-lock reminders (a 24-hour and a 1-hour warning before
each stage locks) are delivered via Web Push.

- **iPhone:** tap **Share → Add to Home Screen**, then open HOTLINE from the new icon. iOS only
  delivers Web Push to an installed, home-screen-launched PWA — this step is mandatory there.
- **Android / desktop:** use the browser's "Install app" / "Add to Home screen" option. Push works
  without installing, but installing is recommended.

Enable reminders under **You → Pick-lock reminders**, then **Send a test reminder** to confirm.

The real 24h/1h reminders are fired by an **in-process scheduler** (`src/instrumentation.ts`, a
~5-min tick) — **no external cron/sidecar**. The scheduler is ON by default (PHA-996); set
`PRELOCK_REMINDERS_DISABLED=1` to turn it off. Cutoffs come from the committed
`COLOGNE_LOCK_SCHEDULE`; `STAGE_LOCKS_JSON` is an optional override. Pure scheduling logic
is in `src/lib/prelock-reminders.ts` and `src/lib/notify-core.ts`.

## Inviting friends

Every player has a stable invite link (`/join/<code>`). Share it from **You → Invite friends**. The
landing page onboards a friend in one tap — local play needs no Steam account.

## Deployment (owner wires SWAG)

Images are published to `ghcr.io/phattbeats/phatt-picks`. Pull `:latest` to track `main`, or pin to
a release tag for rollback:

```bash
docker pull ghcr.io/phattbeats/phatt-picks:latest      # always-current main
docker pull ghcr.io/phattbeats/phatt-picks:vX.Y.Z      # pinnable release (e.g. v0.1.0)
docker pull ghcr.io/phattbeats/phatt-picks:X.Y         # latest patch in that minor line
```

Cutting a release = push a `vX.Y.Z` git tag; CI publishes `:vX.Y.Z`, `:X.Y`, and updates `:latest`.

Build the container to join `phattvip` with the DB on a non-FUSE appdata path. SWAG proxy-conf the
owner installs:

```nginx
# swag: pickems.subdomain.conf
server {
    listen 443 ssl;
    server_name pickems.*;
    include /config/nginx/ssl.conf;
    location / {
        include /config/nginx/proxy.conf;
        resolver 127.0.0.11 valid=30s;
        set $upstream_app major-companion;   # must match the container name on phattvip
        set $upstream_port 3000;
        proxy_pass http://$upstream_app:$upstream_port;
    }
}
```

## Outcome ingestion cadence (PHA-844)

`POST /api/outcomes/ingest` is event-gated, not poll-driven. It returns
`source: "none", reason: "no-locked-unresolved"` whenever the live layout has
zero locked stages with missing `StageOutcome` rows — i.e. pre-event. A
scheduler/cron pointed at this route MUST honor that signal and back off until
stage locks roll over; in that state the route makes **zero** outbound calls to
Liquipedia. The persisted `SourceState.lastCallAt` enforces the 1-req-per-30s
Liquipedia min-interval across container restarts, so even a restart loop
cannot violate the API terms. Regression: `node scripts/verify-outcomes-gate.ts`.

## Attribution

Match results / outcomes: [Liquipedia](https://liquipedia.net) (CC-BY-SA 3.0). Team logos:
[ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API), falling back to self-hosted slugs / monograms.
