/**
 * PHA-4101: PHATT ID (Authentik OIDC, provider "hotline") — I/O side.
 * Authorization-code flow with PKCE + state + nonce; the id_token is verified against the JWKS (iss + aud).
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface PhattIdConfig {
  issuer: string;
  jwksUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  authorizeUrl: string;
  tokenUrl: string;
}

/** Null when PHATT ID is not configured: the button stays hidden and the routes 404. */
export function phattIdConfig(): PhattIdConfig | null {
  const e = process.env;
  if (!e.AUTHENTIK_ISSUER || !e.AUTHENTIK_CLIENT_ID || !e.AUTHENTIK_CLIENT_SECRET || !e.AUTHENTIK_REDIRECT_URI) return null;
  const issuer = e.AUTHENTIK_ISSUER.endsWith("/") ? e.AUTHENTIK_ISSUER : `${e.AUTHENTIK_ISSUER}/`;
  // Authentik serves authorize/token at the application root, not per provider.
  const root = new URL("/application/o/", issuer).toString();
  return {
    issuer,
    jwksUrl: e.AUTHENTIK_JWKS_URL ?? `${issuer}jwks/`,
    clientId: e.AUTHENTIK_CLIENT_ID,
    clientSecret: e.AUTHENTIK_CLIENT_SECRET,
    redirectUri: e.AUTHENTIK_REDIRECT_URI,
    scopes: e.AUTHENTIK_SCOPES ?? "openid profile email steam phatt_type",
    authorizeUrl: `${root}authorize/`,
    tokenUrl: `${root}token/`,
  };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksFor = "";

export async function exchangeAndVerify(cfg: PhattIdConfig, code: string, verifier: string, nonce: string): Promise<JWTPayload> {
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}`);
  const tok = await res.json();
  if (typeof tok?.id_token !== "string") throw new Error("no id_token");
  if (!jwks || jwksFor !== cfg.jwksUrl) {
    jwks = createRemoteJWKSet(new URL(cfg.jwksUrl));
    jwksFor = cfg.jwksUrl;
  }
  const { payload } = await jwtVerify(tok.id_token, jwks, {
    issuer: cfg.issuer,
    audience: cfg.clientId,
    algorithms: ["RS256", "ES256", "EdDSA"],
    clockTolerance: 30,
  });
  if (payload.nonce !== nonce) throw new Error("nonce mismatch");
  return payload;
}
