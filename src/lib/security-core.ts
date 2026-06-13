/**
 * Pure security helpers shared by mutating API routes (PHA-1045, from the
 * PHA-1015 audit). Deliberately free of next/prisma so the verify harness can
 * exercise the CSRF origin check, the trusted-proxy client-IP derivation, and
 * the fixed-window cooldown with no server. Each fix the audit named maps to
 * one function here:
 *
 *   - isAllowedOrigin     → CSRF: only same-origin requests may mutate state.
 *   - clientIpFromForwarded → don't trust a client-settable X-Forwarded-For.
 *   - checkCooldown       → per-key rate limit (push-test amplifier).
 */

/**
 * Normalize a list of origin candidates to bare origins (scheme://host[:port]).
 * Full URLs are parsed; a value that's already a bare origin is kept verbatim.
 * Falsy entries and duplicates are dropped.
 */
export function parseAllowedOrigins(
  ...candidates: (string | undefined | null)[]
): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    let origin: string | null = null;
    try {
      origin = new URL(c).origin;
    } catch {
      const t = c.trim();
      origin = t || null;
    }
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Same-origin guard for a state-changing request. A cross-site <img>/<form>/fetch
 * either omits the Origin header or carries a foreign one; a genuine same-origin
 * POST always sends an Origin (and we fall back to the Referer's origin). We
 * REQUIRE that origin to match one we own, so an absent origin fails closed —
 * the only requests with no Origin are non-browser or cross-site, neither of
 * which should be able to mutate a cookie-authed session.
 *
 * If no allowed origins are configured (e.g. a bare local-dev run with nothing
 * to compare against) the check is a no-op so it never blocks development; the
 * routes always pass their own request origin in, so in practice `allowed` is
 * non-empty wherever the app actually serves.
 */
export function isAllowedOrigin(
  origin: string | null,
  referer: string | null,
  allowed: string[],
): boolean {
  if (allowed.length === 0) return true;
  const candidate = origin && origin !== "null" ? origin : originOf(referer);
  if (!candidate) return false;
  return allowed.includes(candidate);
}

/**
 * Derive the real client IP when sitting behind `trustedHops` reverse proxies.
 *
 * X-Forwarded-For is a comma list "client, proxy1, proxy2, ...". The LEFT-most
 * entry is attacker-settable: a client can send a forged XFF that our proxy
 * then appends its observed peer to. Only the right-most entries were added by
 * infrastructure we control, so behind one trusted proxy (the default) the real
 * peer is the LAST entry. `trustedHops <= 0` disables XFF trust entirely and
 * falls back to X-Real-IP (a single value our own proxy sets, not a
 * client-appendable list).
 */
export function clientIpFromForwarded(
  xff: string | null,
  xRealIp: string | null,
  trustedHops: number,
): string | null {
  if (trustedHops > 0 && xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const idx = Math.max(0, parts.length - trustedHops);
      const ip = parts[idx];
      if (ip) return ip;
    }
  }
  const real = xRealIp?.trim();
  return real || null;
}

/**
 * Fixed-window per-key cooldown. In-memory by design: the production image is a
 * single standalone Node server, so a module-level store is the whole fleet's
 * view. Pure given an injected `now`, so the verify harness can prove the
 * window deterministically.
 */
export interface CooldownStore {
  hits: Map<string, number>;
}

export function createCooldownStore(): CooldownStore {
  return { hits: new Map() };
}

/**
 * Returns whether `key` may act now. On allow, records the hit. On deny,
 * reports the remaining cooldown in ms (does NOT slide the window — a denied
 * request can't extend its own lockout).
 */
export function checkCooldown(
  store: CooldownStore,
  key: string,
  cooldownMs: number,
  now: number,
): { allowed: boolean; retryAfterMs: number } {
  const last = store.hits.get(key);
  if (last !== undefined && now - last < cooldownMs) {
    return { allowed: false, retryAfterMs: cooldownMs - (now - last) };
  }
  store.hits.set(key, now);
  return { allowed: true, retryAfterMs: 0 };
}
