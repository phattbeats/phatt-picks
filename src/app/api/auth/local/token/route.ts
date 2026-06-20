/**
 * POST /api/auth/local/token
 *
 * Generates (or rotates) the cross-device login token for the current local
 * player. Returns JSON { token: string }. Only local players can call this —
 * Steam players have Steam. A new 32-hex-char token is written to Player.loginToken
 * and returned. The old token (if any) is invalidated immediately.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isSameOrigin } from "@/lib/csrf";

export async function POST(req: NextRequest) {
  // CSRF: rotating the token is a cookie-authed mutating simple POST (no JSON
  // body → no CORS preflight), so guard it cross-site like the other mutating
  // routes (PHA-1045). A forged rotation would invalidate the victim's saved
  // login links.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  }

  const session = await getSession();
  if (!session || !session.isLocal) {
    return NextResponse.json({ error: "local_only" }, { status: 403 });
  }

  const token = randomBytes(16).toString("hex"); // 32 hex chars

  await prisma.player.update({
    where: { id: session.playerId },
    data: { loginToken: token },
  });

  return NextResponse.json({ token });
}
