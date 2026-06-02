import { NextRequest, NextResponse } from "next/server";

/**
 * Splash gate (PHA-882).
 *
 * The splash at `/login` is what every visitor sees UNLESS they already have a
 * signed-in session (Steam or local) — i.e. a `phatt_session` cookie. No
 * session → you're sent to the splash to click ENTER and sign in. There is no
 * "browse as guest" path: a session is the only thing that opens the app.
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

export function middleware(req: NextRequest) {
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

  // A signed-in session is the only key past the splash.
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = SPLASH_PATH;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on every page navigation except API routes, Next internals, and any
  // request for a file with an extension (static assets, manifest, sw, icons).
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
