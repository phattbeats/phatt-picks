import { NextRequest, NextResponse } from "next/server";

/**
 * Splash gate (PHA-882).
 *
 * The first time a browser hits the site it must pass through the `/login`
 * splash — the "click to enter" moment. We mark that a visitor has entered
 * with a lightweight `hotline_entered` cookie (set when they advance to the
 * sign-in surface), and a real `phatt_session` also counts as entered. Once
 * either is present the gate is transparent and the rest of the app behaves
 * exactly as before.
 *
 * Exemptions (`/api`, `/_next`, files with extensions) are handled by the
 * matcher below, so this only ever runs for real page navigations.
 */
const ENTERED_COOKIE = "hotline_entered";
const SESSION_COOKIE = "phatt_session";

// Paths that ARE the gate (or the step just past it) — never redirect these,
// and treat reaching the sign-in surface as "entered".
const SPLASH_PATH = "/login";
const PASS_THROUGH = ["/login/auth", "/login/local"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The splash itself is always reachable.
  if (pathname === SPLASH_PATH) return NextResponse.next();

  // Advancing to sign-in counts as passing the gate — stamp the cookie.
  if (PASS_THROUGH.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    const res = NextResponse.next();
    stampEntered(res);
    return res;
  }

  // Already entered (clicked through) or signed in → no gate.
  const entered =
    req.cookies.has(ENTERED_COOKIE) || req.cookies.has(SESSION_COOKIE);
  if (entered) return NextResponse.next();

  // Fresh visitor → send them to the splash to click ENTER.
  const url = req.nextUrl.clone();
  url.pathname = SPLASH_PATH;
  url.search = "";
  return NextResponse.redirect(url);
}

function stampEntered(res: NextResponse) {
  res.cookies.set(ENTERED_COOKIE, "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });
}

export const config = {
  // Run on every page navigation except API routes, Next internals, and any
  // request for a file with an extension (static assets, manifest, sw, icons).
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
