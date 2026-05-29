/**
 * Local-player session creation.
 *
 * Pre-PHA-839 this endpoint unconditionally created a Player row on every GET,
 * so a refresh or a stray click after Steam sign-in produced a duplicate
 * leaderboard entry and silently overwrote the Steam session cookie. We now:
 *
 *   GET  — read the existing session.
 *          • Steam-authed → redirect home, do NOT touch the cookie.
 *          • Local-authed and Player still exists → reissue the cookie
 *            (extends expiry) and redirect home, no DB write.
 *          • Otherwise → redirect to /login/local for the name prompt.
 *   POST — handles the name-prompt form. Same session checks; on the create
 *          path, sanitize the submitted name and mint a Player row.
 *
 * Pure decision lives in src/lib/local-auth-core.ts so the verify harness can
 * exercise the dedup rules without next/prisma.
 */

import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  decideLocalAuthAction,
  randomName,
  sanitizeDisplayName,
  type LocalSessionView,
} from "@/lib/local-auth-core";
import { shouldUseSecureCookie } from "@/lib/session-cookie-core";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_TTL = "30d";
const SESSION_COOKIE_SECURE = shouldUseSecureCookie(BASE_URL);

function getSessionSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET not set");
  return new TextEncoder().encode(secret);
}

async function currentSessionView(): Promise<LocalSessionView> {
  const session = await getSession();
  if (!session) return { kind: "none" };
  if (session.steamId) return { kind: "steam", playerId: session.playerId };
  if (session.isLocal) return { kind: "local", playerId: session.playerId };
  return { kind: "none" };
}

async function reuseLocalSession(playerId: string): Promise<NextResponse | null> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, displayName: true, isLocal: true },
  });
  if (!player || !player.isLocal) return null;

  const token = await new SignJWT({
    sub: player.id,
    displayName: player.displayName,
    isLocal: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(getSessionSecret());

  const response = NextResponse.redirect(new URL("/", BASE_URL));
  response.cookies.set("phatt_session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: SESSION_COOKIE_SECURE,
  });
  return response;
}

async function createLocalPlayer(displayName: string): Promise<NextResponse> {
  const inviteCode = randomBytes(6).toString("hex");
  const player = await prisma.player.create({
    data: { displayName, isLocal: true, inviteCode },
  });

  const token = await new SignJWT({
    sub: player.id,
    displayName,
    isLocal: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(getSessionSecret());

  const response = NextResponse.redirect(new URL("/", BASE_URL));
  response.cookies.set("phatt_session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: SESSION_COOKIE_SECURE,
  });
  return response;
}

export async function GET() {
  try {
    const action = decideLocalAuthAction(await currentSessionView());
    if (action.kind === "preserve-steam") {
      return NextResponse.redirect(new URL("/", BASE_URL));
    }
    if (action.kind === "reuse-local") {
      const reused = await reuseLocalSession(action.playerId);
      if (reused) return reused;
      // session pointed at a Player that no longer exists — fall through to prompt.
    }
    return NextResponse.redirect(new URL("/login/local", BASE_URL));
  } catch (err) {
    console.error("Local auth GET error:", err);
    return NextResponse.redirect(new URL("/login?error=local_create_failed", BASE_URL));
  }
}

export async function POST(req: NextRequest) {
  try {
    const action = decideLocalAuthAction(await currentSessionView());
    if (action.kind === "preserve-steam") {
      return NextResponse.redirect(new URL("/", BASE_URL));
    }
    if (action.kind === "reuse-local") {
      const reused = await reuseLocalSession(action.playerId);
      if (reused) return reused;
    }

    let rawName: string | null = null;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const v = form.get("displayName");
      if (typeof v === "string") rawName = v;
    } else if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as { displayName?: unknown } | null;
      if (body && typeof body.displayName === "string") rawName = body.displayName;
    }

    const displayName = sanitizeDisplayName(rawName, randomName());
    return await createLocalPlayer(displayName);
  } catch (err) {
    console.error("Local auth POST error:", err);
    return NextResponse.redirect(new URL("/login?error=local_create_failed", BASE_URL));
  }
}
