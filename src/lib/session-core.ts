/**
 * Session-core (PHA-982) — the pure, runtime-agnostic half of session handling.
 *
 * WHY this module exists: three places mint or read the `phatt_session` JWT
 * (the Steam callback, the local-auth route, and the splash middleware) and
 * before PHA-982 each inlined its OWN ttl, cookie flags, and sign call. That
 * drift is exactly what bit Brandon: the Steam cookie was minted at 7d and
 * never refreshed, while the local cookie was 30d and re-stamped on activity —
 * so Steam users (the ones who eat a 2FA prompt on every re-login) were forced
 * back through Steam roughly weekly, which *looked* like "the container reset
 * logged me out" because deploys land on a similar cadence.
 *
 * Everything here is jose-only (no next/prisma/fs), so it is safe to import
 * from the Edge middleware AND from Node route handlers AND from the offline
 * verify harness. The cookie *jar* writes live at the call sites (they differ:
 * NextResponse.cookies vs next/headers cookies); only the policy lives here.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * One session lifetime for everyone. 30 days, sliding (see shouldRefreshSession):
 * an active user is re-stamped back to a full 30 days on navigation, so they
 * are effectively never logged out, while a truly abandoned session still dies
 * within 30 days. This unifies the old split (Steam 7d / local 30d) onto the
 * longer, friendlier value — the deliberate choice for a low-stakes pick'em.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_TTL_STRING = "30d";

/** The claims we carry. steamId present => Steam user; isLocal => local user. */
export interface SessionClaims {
  sub: string;
  displayName: string;
  steamId?: string;
  isLocal?: boolean;
}

/**
 * Sliding-refresh decision. Re-stamp the cookie once the token is past the
 * halfway point of its life (remaining < TTL/2). Refreshing on EVERY request
 * would set a cookie on every navigation (wasteful + chatty Set-Cookie);
 * halfway means at most one refresh per ~15 days of continuous use while still
 * guaranteeing an active user never crosses the expiry line.
 *
 * Pure: caller supplies `nowSeconds` so the verify harness is deterministic.
 * A token with no/!numeric `exp` is treated as "refresh" (re-mint a sane one).
 */
export function shouldRefreshSession(
  payload: Pick<JWTPayload, "exp">,
  nowSeconds: number,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): boolean {
  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return true;
  const remaining = exp - nowSeconds;
  return remaining < ttlSeconds / 2;
}

/**
 * Boot/middleware guard: is the signing secret missing or a known placeholder?
 * A Force-Update that drops NEXTAUTH_SECRET from the Unraid template (or a stray
 * dev value) silently invalidates every existing cookie — the #1 way "the
 * container reset logged everyone out" actually happens. We surface it loudly at
 * boot instead of letting users discover it one confused re-login at a time.
 */
export function isPlaceholderSecret(secret: string | undefined | null): boolean {
  if (!secret) return true;
  const s = secret.trim();
  if (s.length < 16) return true;
  const KNOWN_BAD = new Set([
    "dev-only-not-committed",
    "replace_me",
    "smoke-test-secret-not-real",
    "changeme",
    "secret",
  ]);
  return KNOWN_BAD.has(s.toLowerCase());
}

/** One cookie shape for all three mint sites. secure only in production. */
export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: isProduction,
  };
}

/** Mint a session JWT with the shared TTL. Used by every sign site. */
export function signSessionToken(
  claims: SessionClaims,
  secret: string,
  ttl: string = SESSION_TTL_STRING,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  // Drop undefined claims so the payload stays clean.
  const payload: Record<string, unknown> = {
    sub: claims.sub,
    displayName: claims.displayName,
  };
  if (claims.steamId !== undefined) payload.steamId = claims.steamId;
  if (claims.isLocal !== undefined) payload.isLocal = claims.isLocal;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key);
}

/** Verify + decode a token. Returns null on any failure (bad sig, expired). */
export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return payload;
  } catch {
    return null;
  }
}
