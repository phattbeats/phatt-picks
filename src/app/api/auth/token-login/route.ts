/**
 * GET /api/auth/token-login?t=<token>
 *
 * Validates a local-player login token from Player.loginToken, mints a new
 * session cookie, and redirects home. If the token is unknown or the player
 * is not local, redirects to /login/auth with an error query param.
 *
 * Tokens are intentionally NOT invalidated on use — they persist until the
 * player regenerates via POST /api/auth/local/token, so the same link works
 * every time on every device.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signSessionToken, sessionCookieOptions } from "@/lib/session-core";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

function requireSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET not set");
  return secret;
}

export async function GET(req: NextRequest) {
  try {
    const t = req.nextUrl.searchParams.get("t");
    if (!t) {
      return NextResponse.redirect(new URL("/login/auth?error=no_token", BASE_URL));
    }

    const player = await prisma.player.findUnique({
      where: { loginToken: t },
      select: { id: true, displayName: true, isLocal: true },
    });

    if (!player || !player.isLocal) {
      return NextResponse.redirect(new URL("/login/auth?error=invalid_token", BASE_URL));
    }

    const token = await signSessionToken(
      { sub: player.id, displayName: player.displayName, isLocal: true },
      requireSecret(),
    );

    const response = NextResponse.redirect(new URL("/", BASE_URL));
    response.cookies.set(
      "phatt_session",
      token,
      sessionCookieOptions(process.env.NODE_ENV === "production"),
    );
    return response;
  } catch (err) {
    console.error("Token login error:", err);
    return NextResponse.redirect(new URL("/login/auth?error=token_login_failed", BASE_URL));
  }
}
