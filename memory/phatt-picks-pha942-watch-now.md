---
name: phatt-picks-pha942-watch-now
description: PHA-942 "Watch Now" band on dashboard — official IEM Cologne streams; in_review awaiting ship confirmation
metadata:
  type: project
---

PHA-942 "add ways to watch on the homepage/dashboard": Brandon wanted an enticing **WATCH NOW** section below everything else on the home dashboard, with the IEM Cologne major logo + Twitch/YouTube/Kick official streams; he watches YouTube; screenshot it.

**Built:** `src/components/watch/WatchNow.tsx` (pure server component, no client JS) rendered in `src/app/(app)/page.tsx` after the Wire panel. White-treated official IEM lockup (`public/watch/iem-cologne.png`, from Wikimedia, `filter: brightness(0) invert(1)` so black/blue reads on dark theme) + "WATCH NOW" headline + 3 tiles linking ESL's official channels: **YouTube `@ESLCS`** (featured, "Brandon watches here" flag, first), **Twitch `eslcs`**, **Kick `eslcs`**. Brand glyphs = inlined simple-icons SVG w/ official colors (YT red / Twitch purple / Kick green). Channels verified live 2026-06-05 (all 200; Kick 403 to curl=Cloudflare, confirmed via crawl4ai).

**Status: DONE + LIVE 2026-06-06.** Conf `e29e0375` accepted → merged PR #44 `5ae9e81`. Brandon follow-up "take away the brandon watches here lol... not what we need" → removed the YouTube flag + featured highlight (all 3 tiles now clean/equal, YT leads by order); PR #51 merged `ca9b0c4`. **SELF-DEPLOYED** via phatt-claw (pulled `:latest` rev label==`ca9b0c4`, recreated live container `63d25972` image `4e3e8cb5`, bak pruned); live `/api/health` ok, live HTML proves band renders + zero "Brandon watches here". Deploy recipe = [[phatt-picks-pha918-live-leaderboard]].

GOTCHA this run: browserless (`/browserless` container `0b55dc4268ed`) queue got stuck (queued grew, /function hung 0-bytes even on a trivial fn though /pressure said available) → `POST http://phatt-claw:2375/containers/0b55dc4268ed/restart?t=10` cleared it. Also the dev-server container IP changed between runs (.35 then .26) — always read `Network:` from the next-dev log before pointing browserless at it.

**Screenshot recipe that worked** (dashboard is behind phatt_session middleware): `npx prisma db push` to sync the stale committed `prisma/dev.db` schema (it lacked NewsItem etc.) → run `next dev` with **absolute** `DATABASE_URL="file:$(pwd)/prisma/dev.db"` (shell exports a postgres DATABASE_URL that overrides .env; relative `file:./dev.db` resolves to project root = empty/no tables) → mint phatt_session JWT (jose HS256, sub=seed-alice, secret `dev-only-not-committed`) → browserless `/function` at container IP `172.18.0.35:3199`, setCookie domain=that IP, screenshot. Restore `git checkout -- prisma/dev.db` after (db push mutates the tracked file).
