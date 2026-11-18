/**
 * PHA-4101: start "Sign in with PHATT ID" (Authentik OIDC, provider "hotline").
 * Steam is reached through PHATT ID: a member who linked Steam on their profile signs in once and
 * is matched to their existing Hotline Steam player. The old /api/auth/steam login stays until cutover.
 */

import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { phattIdConfig } from "@/lib/phatt-id";

const b64u = (b: Buffer) => b.toString("base64url");

export async function GET() {
  const cfg = phattIdConfig();
  if (!cfg) return NextResponse.json({ error: "phatt_id_not_configured" }, { status: 404 });
  const state = b64u(randomBytes(24));
  const nonce = b64u(randomBytes(24));
  const verifier = b64u(randomBytes(32));
  const challenge = b64u(createHash("sha256").update(verifier).digest());
  const u = new URL(cfg.authorizeUrl);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const res = NextResponse.redirect(u);
  res.cookies.set("phatt_oidc", JSON.stringify({ state, nonce, verifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/callback/authentik",
    maxAge: 600,
  });
  return res;
}
