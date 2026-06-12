import { NextRequest, NextResponse } from "next/server";
import {
  shouldRefreshSession,
  signSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  type SessionClaims,
} from "@/lib/session-core";

/**
 * Splash gate (PHA-882) + sliding session refresh (PHA-982).
 *
 * The splash at `/login` is what every visitor sees UNLESS they already have a
 * signed-in session (Steam or local) — i.e. a `phatt_session` cookie. No
 * session → you're sent to the splash to click ENTER and sign in. There is no
 * "browse as guest" path: a session is the only thing that opens the app.
 *
 * PHA-982 — this gate used to trust the mere PRESENCE of the cookie. That left
 * two papercuts: (1) a cookie whose signature no longer verifies (e.g. the
 * signing secret rotated on a container recreate) sailed past the gate, then
 * every page's getSession() returned null — a confusing "logged in but logged
 * out everywhere" limbo with no clean way back to a fresh login. (2) nothing
 * extended an active user's session, so it expired on a fixed clock. We now
 * verify the token here and, for a still-valid one that's past the halfway
 * mark, re-stamp it back to a full lifetime — so anyone who keeps using the app
 * is effectively never logged out. A token that fails verification is cleared
 * and the user is sent to the splash for a clean re-login.
 *
 * Fail-open on a MISSING secret: if NEXTAUTH_SECRET is somehow unset at the
 * edge we let an existing cookie through rather than bouncing the whole user
 * base to /login — a misconfig shouldn't read as a mass logout. (The boot
 * guard in instrumentation.ts shouts about a missing/placeholder secret so it
 * gets fixed fast.)
 *
 * Paths reachable without a session are the splash itself, the sign-in
 * surfaces it leads to (`/login/auth`, `/login/local`), and invite links
 * (`/join/<code>`) — an invite is a brand-new user's front door, so it must
 * never bounce to the splash and eat the code.
 *
 * `/api`, `/_next`, and any file-with-extension are excluded by the matcher,
 * so this only runs for real page navigations.
 */
const SESSION_COOKIE = "phatt_session";
const SPLASH_PATH = "/login";

// Prefixes that do NOT require a session. `/login` covers the splash and both
// sign-in surfaces; `/join` covers invite landings.
const PUBLIC_PREFIXES = ["/login", "/join"];

function bounceToSplash(req: NextRequest, clearCookie: boolean): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = SPLASH_PATH;
  url.search = "";
  const res = NextResponse.redirect(url);
  // Drop a dead/forged cookie so the browser stops re-presenting it and the
  // user lands on a clean login instead of looping through the limbo state.
  if (clearCookie) res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Opening an invite link captures the referral: stamp the inviter's code so
  // it can be attributed when this visitor creates an account (local or Steam).
  if (pathname.startsWith("/join/")) {
    const code = pathname.slice("/join/".length).split("/")[0];
    const res = NextResponse.next();
    if (code) {
      res.cookies.set("hotline_ref", code, {
        path: "/",
        maxAge: 60 * 60 * 24 * 14,
        sameSite: "lax",
        httpOnly: true,
      });
    }
    return res;
  }

  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (isPublic) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return bounceToSplash(req, false);

  const secret = process.env.NEXTAUTH_SECRET;
  // Missing secret at the edge → fail open (don't mass-logout on a misconfig).
  if (!secret) return NextResponse.next();

  const payload = await verifySessionToken(token, secret);
  if (!payload || typeof payload.sub !== "string") {
    // Bad signature or expired — clear it and send to a clean login.
    return bounceToSplash(req, true);
  }

  const res = NextResponse.next();

  // Sliding refresh: an active user past the halfway mark gets re-stamped to a
  // full lifetime, so continued use never expires the session.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (shouldRefreshSession(payload, nowSeconds)) {
    const claims: SessionClaims = {
      sub: payload.sub,
      displayName: typeof payload.displayName === "string" ? payload.displayName : "",
      steamId: typeof payload.steamId === "string" ? payload.steamId : undefined,
      isLocal: typeof payload.isLocal === "boolean" ? payload.isLocal : undefined,
    };
    try {
      const fresh = await signSessionToken(claims, secret);
      res.cookies.set(
        SESSION_COOKIE,
        fresh,
        sessionCookieOptions(process.env.NODE_ENV === "production"),
      );
    } catch {
      // Re-sign failed — leave the still-valid cookie as-is, never block nav.
    }
  }

  return res;
}

export const config = {
  // Run on every page navigation except API routes, Next internals, and any
  // request for a file with an extension (static assets, manifest, sw, icons).
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
