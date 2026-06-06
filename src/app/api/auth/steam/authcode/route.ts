/**
 * Capture + store a player's per-user Valve Pick'Em auth code ("steamidkey").
 *
 * The code is NOT part of the OpenID flow — the user copies it from Steam and
 * submits it here after signing in. We encrypt it at rest (AES-256-GCM via
 * src/lib/crypto.ts) and never echo it back. Decryption happens server-side
 * only, through getDecryptedAuthCode() in src/lib/authcode.ts.
 *
 * Rule #2: the code is stored as an encrypted string; SteamID stays a string.
 * Rule #10: real codes are owner-provided secrets — never committed.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { encryptAuthCode } from "@/lib/crypto";
import { mirrorPlayerPredictions } from "@/lib/predictions-sync";
import { ACTIVE_EVENT_ID } from "@/lib/events-core";

const EVENT_ID = ACTIVE_EVENT_ID;
// Valve auth codes are uppercase alphanumeric in a 4-5-4 hyphenated shape (e.g. ABCD-12345-WXYZ).
const AUTH_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // A Valve auth code is only meaningful for a Steam-linked account.
  if (session.isLocal || !session.steamId) {
    return NextResponse.json({ error: "steam_account_required" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const raw = (body as { authCode?: unknown } | null)?.authCode;
  const authCode = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!AUTH_CODE_RE.test(authCode)) {
    return NextResponse.json({ error: "invalid_auth_code_format" }, { status: 400 });
  }

  await prisma.player.update({
    where: { id: session.playerId },
    data: { authCode: encryptAuthCode(authCode) },
  });

  // PHA-853: as soon as the auth code is stored, pull any existing/partial
  // Valve picks into the local Pick table so the user's next /picks visit
  // shows what's already on their Steam account (no manual sync click).
  // Mirror failures don't fail the save — the encrypted code is already
  // persisted, and the page-load mirror will retry within 60s.
  const mirror = await mirrorPlayerPredictions(session.playerId, EVENT_ID).catch(
    (e) => ({ ok: false, mirrored: 0, error: e instanceof Error ? e.message : String(e) }),
  );

  return NextResponse.json({
    ok: true,
    hasAuthCode: true,
    mirrored: mirror.mirrored,
    mirrorOk: mirror.ok,
  });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await prisma.player.update({
    where: { id: session.playerId },
    data: { authCode: null },
  });
  return NextResponse.json({ ok: true, hasAuthCode: false });
}
