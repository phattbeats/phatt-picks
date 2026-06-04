# Operations

Container env vars, HTTP routes, and one-time setup for `pickems.phatt.vip`.

## Environment variables

Every var the running app reads. Pre-populated values in the Unraid template
(`scripts/phatt-picks.unraid.xml`) are sane defaults — rotate when convenient,
not on a schedule. **Required** = the app errors or skips features when missing.

| Var | Required | Read by | Behavior |
|---|---|---|---|
| `DATABASE_URL` | yes | Prisma | SQLite path. In-container default `file:/data/phatt-picks.db`. Must point at a real disk path (an Unraid cache/appdata bind), **not** a FUSE `/mnt/user` share — SQLite's WAL locking breaks on FUSE. |
| `NEXTAUTH_URL` | yes | Steam OpenID callback, invite-link builder, session cookie scope | Public origin the app is reached at (`https://pickems.phatt.vip`). Must match the SWAG host exactly or Steam OpenID will reject the realm. |
| `NEXTAUTH_SECRET` | yes | Session JWT signing | Any high-entropy string. Rotate any time with `openssl rand -base64 32` — existing sessions become invalid until users reload. |
| `STEAM_API_KEY` | yes for live read/write | `src/lib/valve.ts` | Your Steam Web API key from <https://steamcommunity.com/dev/apikey>. Server-side only — never reaches the client. Without it the read pipeline can't pull predictions / items and the write path 401s. |
| `AUTH_CODE_ENCRYPTION_KEY` | yes for Steam users | `src/lib/crypto.ts` | 32-byte hex (64 hex chars). Encrypts each user's Steam Pick'Em auth code at rest with AES-256-GCM. Rotating it invalidates every stored auth code — users have to repaste at `/help/auth-code`. |
| `WRITE_ENABLED` | optional, default `false` | `src/lib/picks-write.ts:42` | **DESTRUCTIVE if `true`.** Gates the Steam upload path. When `false`, every `Lock In to Steam` click skips with `Steam sync disabled by owner`; local picks still save. Set to `true` once you're ready to lock real picks on Valve's servers. |
| `OWNER_STEAM_ID` | optional | `src/lib/owner.ts` | SteamID64 (string, e.g. `7656119xxxxxxxxxx`) of the single owner. Unlocks the `/profile` "Admin · Local players" section and the `/api/players/local*` cleanup endpoints. When unset, the gate fails closed (nobody is owner). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | optional | `src/lib/notify.ts` | Web Push keys. Pre-generated and paired in the template. Generate a fresh pair with `npx web-push generate-vapid-keys` — rotating invalidates every push subscription (users have to re-opt-in). When either is missing, `/api/push/public-key` returns `{ key: null }` and the UI hides the opt-in. |
| `VAPID_SUBJECT` | optional | `src/lib/notify.ts` | Contact URI sent with every push (`mailto:brandon@phatt.tech`). Required by the Web Push spec; web-push will throw without it. |
| `NODE_ENV` | optional, default `production` in image | `src/app/api/auth/steam/callback/route.ts:86` | Leave as `production` in the deployed container. (Used only to enable a dev-only debug branch in the Steam callback.) |

### Common tweaks

- **Enable real Steam writes** → set `WRITE_ENABLED=true` and restart. Watch `Lock In to Steam` pill flip from `Steam sync disabled by owner` to `Add your Steam auth code to sync` (or `Synced to Steam (N picks)` once code is stored).
- **Disable push entirely** → unset `VAPID_PUBLIC_KEY`. UI hides the opt-in; existing subscriptions become dormant (no errors, just no deliveries).
- **Move the DB** → change the `/data` Unraid bind, restart. Run `npx prisma db push` against the new path once.

## HTTP routes

### Pages

| Path | Auth | Source |
|---|---|---|
| `/` | open (dashboard chip changes per session) | `src/app/(app)/page.tsx` |
| `/login` | open | `src/app/login/page.tsx` |
| `/login/local` | open (creates local-only player on submit) | `src/app/login/local/page.tsx` |
| `/picks` | open (read-only without session); pickable with session | `src/app/picks/page.tsx` — Swiss stages render bucketed cards, drag-drop + tap-to-arm, `Lock In to Steam` for steam-linked sessions |
| `/leaderboard` | open | `src/app/leaderboard/page.tsx` |
| `/leaderboard/compare` | open | `src/app/leaderboard/compare/page.tsx` |
| `/news` | open | `src/app/news/page.tsx` |
| `/players/[id]` | open | `src/app/players/[id]/page.tsx` |
| `/profile` | session-gated | `src/app/profile/page.tsx` |
| `/help/auth-code` | open (instructions for capturing the Steam Pick'Em code) | `src/app/help/auth-code/page.tsx` |
| `/join/[code]` | open (invite-link landing → onboards to a Steam or local session) | `src/app/join/[code]/page.tsx` |

### API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | open | `{status, db}` — used by Docker healthcheck. |
| `GET` | `/api/auth/steam` | open | Kick off Steam OpenID 2.0 → redirects to Steam. |
| `GET` | `/api/auth/steam/callback` | open | OpenID callback. Verifies assertion, upserts Player, issues session cookie. Bigint-safe SteamID64 handling (rule #2). |
| `POST` | `/api/auth/steam/authcode` | session | Capture + AES-256-GCM-encrypt the player's per-user Steam Pick'Em auth code. Body `{ authCode }`. Never echoed back. |
| `GET` / `POST` | `/api/auth/local` | open (POST creates session) | Local-player onboarding. PHA-839 dedup rules in `src/lib/local-auth-core.ts`. |
| `GET` | `/api/auth/logout` | open | Clear session cookie, redirect to `/login`. |
| `GET` | `/api/invite` | session | Mint/return the session player's stable invite code + absolute `/join` URL. |
| `GET` | `/api/picks?sectionId=…` | session | List the session player's stored picks. |
| `POST` | `/api/picks` | session | Upsert a batch of picks for one section. Auto-rejects writes to a stage whose `picks_allowed` flipped off or whose outcomes resolved (409 `stage_locked`). Per-pick layout validation via `validatePickAgainstLayout` (400 with reason). |
| `POST` | `/api/picks/sync` | session | **Read path** — fetch live `GetTournamentPredictions` for the session player, mirror into local `Pick` table. Throttled. Graceful degrade. |
| `POST` | `/api/picks/sync-stage` | session | **Write path** — push the session player's locally-stored picks up to Valve via `UploadTournamentPredictions`. Body `{ sectionId }` for a Swiss stage or `{ playoff: true }` for the bracket (one ordered QF→SF→GF call). Returns a `WriteResult` (`ok` / `skipped` / `degraded` / `escalate`); the UI's `Lock In to Steam` pill copies from that shape. |
| `GET` | `/api/leaderboard` | open | Scores all players (local + synced) against resolved `StageOutcome` rows. Picks hidden until stage lock; coin tier only when `synced && hasViewerPass && hasValveCoin` (rule #4). |
| `POST` | `/api/outcomes/ingest` | session (operational) | Pull stage results from Liquipedia / Valve, write `StageOutcome` rows. Event-gated (PHA-844) — responds `reason: "no-locked-unresolved"` when nothing's resolvable; callers MUST back off. |
| `GET` | `/api/push/public-key` | open | VAPID public key for browser subscribe. Returns `{ key: null }` when push isn't configured. |
| `POST` | `/api/push/subscribe` | session | Store a browser `PushSubscription`. Idempotent on endpoint. |
| `POST` | `/api/push/unsubscribe` | session | Remove a subscription by endpoint. No-op if not ours. |
| `POST` | `/api/push/test` | session | Send a sample pre-lock reminder to the caller's own devices. |
| `GET` | `/api/players/local` | session + owner | Owner-only list of local-only Players (`isLocal && steamId IS NULL`) with `pickCount` and `lastActivity`. 403 for any other session. |
| `DELETE` | `/api/players/local/:id` | session + owner | Owner-only hard delete of one local Player; Prisma cascade wipes their `Pick` + `PushSubscription` rows. Refuses Steam-linked players (400 `not_local`) and self-delete (400 `self_delete`). |

## One-time setup

After a fresh container start against a fresh SQLite file:

```bash
# inside the container
npx prisma db push                # creates the schema
node scripts/build-logos.ts       # warms team logo cache (optional but skips first-request lag)
```

`SourceState` (the Liquipedia ingestion gate added in PHA-844) is part of the
Prisma schema — `prisma db push` covers it; you don't need a separate migration step.

## Smoke after a config flip

```
GET  /api/health                   → 200 {"status":"ok","db":"ok"}
open /picks                        → 3 bucket cards on Stage I (2 / 6 / 2)
open /picks (Steam session)        → Lock In to Steam button visible
                                     pill = "Saved locally" or "Synced to Steam (N picks)"
```

If `Lock In` shows `Steam sync disabled by owner`, `WRITE_ENABLED` isn't set true.
If it shows `Add your Steam auth code to sync`, hit `/help/auth-code` and paste.

## Verify scripts

Each milestone ships an offline harness under `scripts/verify-*.ts` (no bundler,
no DB, no network). Run the **whole suite** with one command:

```
node scripts/verify-all.mjs
```

This spawns every `scripts/verify-*.ts` under `--experimental-strip-types` and
exits non-zero if any fails (CI-gateable). Each line is a `──── name ────`
banner; the tail prints `ALL GREEN` or the list of failures.

To run a single verify on its own, mirror what the runner does:

```
node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
     --no-warnings scripts/verify-m9-4-swiss-bucket.ts
```

### Why the `--import ./scripts/register-ts-resolve.mjs` flag

The app uses `moduleResolution: "bundler"` (tsconfig), so source files import
siblings **without** a file extension (e.g. `import { x } from "./swiss-bucket-core"`).
Node's stock ESM resolver does NOT auto-append `.ts`, so any verify whose import
chain reaches such a *value* import dies with `ERR_MODULE_NOT_FOUND` under bare
`--experimental-strip-types`. `register-ts-resolve.mjs` installs a tiny,
zero-dependency resolver hook (`ts-resolve-hook.mjs`) that retries failed
relative specifiers against `.ts`/`.tsx`/`.js`/`/index.ts` — matching what the
bundler would have found. **Do not** add `.ts` extensions to the source imports:
that breaks `tsc`'s bundler resolution unless `allowImportingTsExtensions` is set.
`verify-all.mjs` passes this flag for you.
