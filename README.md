# phaTT Picks

A CS2 Major Pick'Em companion for a small private group, targeting **IEM Cologne 2026**
(June 2–21). Members log in with Steam (or play locally — no Steam needed), set/mirror their
picks, and compete on a shared leaderboard scored on Valve's own weighting. Built generically so
it can be re-pointed at future Majors.

Next.js (App Router) + TypeScript + Prisma/SQLite. Deploys as a single container on the
`phattvip` network behind SWAG at `pickems.phatt.vip`. The responsive **installable PWA** is the
entire mobile story (no native apps).

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
| `WRITE_ENABLED` | `"true"` enables the stage-batched write-back to Valve. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keypair. Generate: `npx web-push generate-vapid-keys`. |
| `VAPID_SUBJECT` | `mailto:` contact for push. |
| `STAGE_LOCKS_JSON` | (optional) per-section pick cutoffs for the reminder job, e.g. `{"105":{"name":"Stage I","lockAt":"2026-06-02T09:00:00Z"}}`. |

## PWA install & push reminders

phaTT Picks is an installable PWA (`public/manifest.json` + `public/sw.js`). Installing is
**required for push on iOS** — opt-in pre-lock reminders (a 24-hour and a 1-hour warning before
each stage locks) are delivered via Web Push.

- **iPhone:** tap **Share → Add to Home Screen**, then open phaTT Picks from the new icon. iOS only
  delivers Web Push to an installed, home-screen-launched PWA — this step is mandatory there.
- **Android / desktop:** use the browser's "Install app" / "Add to Home screen" option. Push works
  without installing, but installing is recommended.

Enable reminders under **You → Pick-lock reminders**, then **Send a test reminder** to confirm.

The scheduler that fires the real 24h/1h reminders is `scripts/send-prelock-reminders.ts`, run on a
short cadence by the in-container sidecar/cron once `STAGE_LOCKS_JSON` holds the live cutoffs. Pure
scheduling logic lives in `src/lib/notify-core.ts`.

## Inviting friends

Every player has a stable invite link (`/join/<code>`). Share it from **You → Invite friends**. The
landing page onboards a friend in one tap — local play needs no Steam account.

## Deployment (owner wires SWAG)

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

## Attribution

Match results / outcomes: [Liquipedia](https://liquipedia.net) (CC-BY-SA 3.0). Team logos:
[ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API), falling back to self-hosted slugs / monograms.
