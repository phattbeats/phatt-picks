---
name: phatt-picks-pha982-sessions
description: Re-auth-on-reset fix — sliding 30d sessions + secret-rotation guard. Steam was 7d non-sliding; middleware trusted cookie presence not validity.
metadata:
  type: project
---

PHA-982 (Brandon: "container resets → I have to re-login on phone, esp Steam 2FA, I HATE re-authing"). **Root: cookies live in the BROWSER, a container reset can't delete them — the session stops VERIFYING.** Two mechanics:

1. **Lifetime drift.** `steam/callback` minted **7d** non-sliding cookie; `local/route` minted **30d** + re-stamped via `reuseLocalSession`. Steam users (2FA each re-login) forced back ~weekly; deploys land on similar cadence → *looked* like reset logged them out.
2. **Middleware trusted cookie PRESENCE not validity** (`cookies.has`). A cookie that no longer verifies (secret rotated on recreate) sailed past gate → every page `getSession()`→null → "logged in but logged out everywhere" limbo.

**Fix (PR #63, branch `pha982-session-longevity`, commit `64c9d1b`):**
- NEW `src/lib/session-core.ts` — pure edge-safe policy: `SESSION_TTL_SECONDS`(30d)/`SESSION_TTL_STRING`, `shouldRefreshSession(payload,nowSec)` (refresh when remaining < TTL/2, i.e. past halfway = sliding), `isPlaceholderSecret`, `sessionCookieOptions(isProd)`, `signSessionToken`, `verifySessionToken`. jose-only (no next/prisma/fs) so middleware+routes+verify all import it.
- `middleware.ts` now **async**: verifies token; missing secret→**fail open** (don't mass-logout on misconfig); invalid→`bounceToSplash(clearCookie:true)`; valid+past-halfway→re-sign+set cookie (sliding). Active user effectively never logged out.
- steam+local routes use shared `signSessionToken`+`sessionCookieOptions` (Steam 7d→30d unified).
- `instrumentation.ts` boot guard: loud `console.error` if `isPlaceholderSecret(NEXTAUTH_SECRET)`, else `[session] NEXTAUTH_SECRET present…`. Runs before prelock gating, nodejs runtime only.
- `scripts/verify-session.ts` 27/27 (refresh boundary strict `<`, secret guard, cookie flags, sign/verify round-trip + rotation rejection).
- `docs/OPERATIONS.md`: NEXTAUTH_SECRET MUST be in Unraid TEMPLATE not ad-hoc (Force-Update drops ad-hoc vars→rotates→mass logout).

Verify: verify-session 27/27, suite 36 scripts/836+ assertions/0 fail, tsc clean, prod build green (middleware compiles in Edge w/ jose).

**Live container check (phatt-claw, container `71160d5e`):** NEXTAUTH_SECRET len 44 (base64-32, real, `1Dt2Rx…Jho=`), NODE_ENV=production, **NEXTAUTH_URL=http://hotline.phatt.vip** (note: HTTP + "hotline" not compose's https://pickems). Secret present now = likely templated/stable, but code now GUARANTEES robustness regardless.

**Status: in_review** — comment `c04964fa` posted + request_confirmation `4fec90c8` (pending, `wake_assignee`, `supersedeOnUserComment`) asks Brandon to (a) approve merge — trade-off = Steam 7d→30d loosening — and (b) confirm secret is in the template. On accept→I merge PR#63→main→Brandon Force-Updates. phatt-picks container NOT phattclaw.managed (can't self-restart; deploy = Brandon Force-Update). Related: [[phatt-picks-pha929-prelock-scheduler]] (instrumentation.ts), [[phatt-picks-pha948-event-registry]].
