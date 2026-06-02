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
 *          Spam guards (PHA-881):
 *            1. CAPTCHA — Cloudflare Turnstile token verified server-side.
 *               Skipped when TURNSTILE_SECRET_KEY is unset (local dev).
 *            2. IP limit — no more than 5 local accounts per client IP.
 *               Skipped when the IP cannot be determined.
 *
 * Pure decision lives in src/lib/local-auth-core.ts so the verify harness can
 * exercise the dedup rules without next/prisma.
 */

import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { verifyTurnstile } from "@/lib/captcha";
import { attributeReferral } from "@/lib/invite";
import {
  decideLocalAuthAction,
  randomName,
  sanitizeDisplayName,
  type LocalSessionView,
} from "@/lib/local-auth-core";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_TTL = "30d";
const IP_ACCOUNT_LIMIT = 5;

function getSessionSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET not set");
  return new TextEncoder().encode(secret);
}

function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0].trim();
    if (ip) return ip;
  }
  return req.headers.get("x-real-ip");
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
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

async function createLocalPlayer(
  displayName: string,
  ip: string | null,
  refCode: string | null,
): Promise<NextResponse> {
  const inviteCode = randomBytes(6).toString("hex");
  const player = await prisma.player.create({
    data: {
      displayName,
      isLocal: true,
      inviteCode,
      createdFromIp: ip ?? null,
    },
  });

  // Referral attribution — best-effort, never blocks signup.
  try {
    await attributeReferral(player.id, refCode);
  } catch (err) {
    console.error("Referral attribution error (local):", err);
  }

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
    secure: process.env.NODE_ENV === "production",
  });
  // Referral consumed (or no-op) — clear the capture cookie.
  response.cookies.set("hotline_ref", "", { path: "/", maxAge: 0 });
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
    return NextResponse.redirect(new URL("/login/auth?error=local_create_failed", BASE_URL));
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

    const ip = getClientIp(req);

    // IP account limit: reject if this IP already has >= IP_ACCOUNT_LIMIT local players.
    if (ip) {
      const count = await prisma.player.count({
        where: { createdFromIp: ip, isLocal: true },
      });
      if (count >= IP_ACCOUNT_LIMIT) {
        return NextResponse.redirect(
          new URL("/login/local?error=ip_limit", BASE_URL),
        );
      }
    }

    let rawName: string | null = null;
    let captchaToken: string | null = null;
    const contentType = req.headers.get("content-type") ?? "";
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await req.formData();
      const v = form.get("displayName");
      if (typeof v === "string") rawName = v;
      const t = form.get("cf-turnstile-response");
      if (typeof t === "string") captchaToken = t;
    } else if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as {
        displayName?: unknown;
        captchaToken?: unknown;
      } | null;
      if (body && typeof body.displayName === "string") rawName = body.displayName;
      if (body && typeof body.captchaToken === "string")
        captchaToken = body.captchaToken;
    }

    // Turnstile CAPTCHA — skipped when TURNSTILE_SECRET_KEY is unset.
    const captchaOk = await verifyTurnstile(captchaToken, ip);
    if (!captchaOk) {
      return NextResponse.redirect(
        new URL("/login/local?error=captcha", BASE_URL),
      );
    }

    const displayName = sanitizeDisplayName(rawName, randomName());
    const refCode = req.cookies.get("hotline_ref")?.value ?? null;
    return await createLocalPlayer(displayName, ip, refCode);
  } catch (err) {
    console.error("Local auth POST error:", err);
    return NextResponse.redirect(new URL("/login/auth?error=local_create_failed", BASE_URL));
  }
}
