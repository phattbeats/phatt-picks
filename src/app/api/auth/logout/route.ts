/**
 * POST /api/auth/logout — clear the session cookie and return to /login.
 *
 * PHA-1045 (CSRF, from the PHA-1015 audit): this was a GET, so a cross-site
 * `<img src=".../api/auth/logout">` silently logged out any visiting user —
 * SameSite=Lax does NOT block top-level GET navigations. It's now POST-only
 * with a same-origin guard, so only a request from our own pages can end a
 * session. The redirect uses 303 so the browser issues a GET for /login after
 * the POST.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAllowedOrigin, parseAllowedOrigins } from "@/lib/security-core";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export async function POST(req: NextRequest) {
  const allowed = parseAllowedOrigins(req.nextUrl.origin, BASE_URL);
  if (
    !isAllowedOrigin(
      req.headers.get("origin"),
      req.headers.get("referer"),
      allowed,
    )
  ) {
    return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  }

  const response = NextResponse.redirect(new URL("/login", BASE_URL), 303);
  response.cookies.set("phatt_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
