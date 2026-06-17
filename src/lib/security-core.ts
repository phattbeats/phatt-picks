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

/**
 * Both scheme variants of a trusted Host header, e.g. "hotline.phatt.vip" →
 * ["https://hotline.phatt.vip", "http://hotline.phatt.vip"].
 *
 * WHY (PHA-1225): the app runs behind a TLS-terminating proxy (swag/nginx) and
 * is reached over https, but NEXTAUTH_URL is http://hotline.phatt.vip and the
 * request reaches the container over plain http — so both `req.nextUrl.origin`
 * and BASE_URL are http-scheme. A real browser on the https site sends
 * `Origin: https://hotline.phatt.vip`, which matched NEITHER → sign-out 403'd.
 * The HOST is what identifies an origin as ours; accepting either scheme for the
 * forwarded host fixes the drift without trusting a foreign host (evil.example
 * still fails) and without touching the deployment's env.
 *
 * Reject values carrying a path/space/backslash (a malformed or injected Host)
 * so we only ever emit a clean scheme://host[:port].
 */
export function hostOriginVariants(host: string | null | undefined): string[] {
  const h = host?.trim();
  if (!h || h.includes("/") || h.includes(" ") || h.includes("\\")) return [];
  return [`https://${h}`, `http://${h}`];
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
 * Same-origin guard for a state-changing request. A cross-site <form>/fetch
 * carries a foreign Origin; a genuine same-origin POST either sends a matching
 * Origin (we fall back to the Referer's origin) OR — on iOS WebKit (Safari,
 * Brave, every iOS browser) — sends NEITHER header on a top-level same-origin
 * form-POST navigation. That headerless case is exactly what "profile › Sign
 * out" is, and PHA-1225 caught it failing closed with {"error":"Bad origin"}.
 *
 * So we fail OPEN only when BOTH Origin and Referer are entirely absent. This is
 * safe because every route behind this guard is authed by a SameSite=Lax session
 * cookie: a cross-site POST never sends that cookie, and a cross-site form POST
 * always carries an Origin header — so the only requests that reach the both-
 * absent branch are same-origin navigations (or cookieless non-browser callers,
 * which can't mutate anything). An OPAQUE origin arrives as the literal string
 * "null" (a header that IS present), which is NOT this case and still fails
 * closed below.
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
  // iOS WebKit same-origin form POST: no Origin AND no Referer. See above.
  if (origin == null && referer == null) return true;
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
 *
 * The Map is unbounded by design but bounded in practice: keys are player ids,
 * so cardinality tops out at the player count and resets on every container
 * restart. Do NOT reuse this store for an unbounded key space (raw IPs, request
 * paths) without adding a sweep.
 */
export interface CooldownStore {
  hits: Map<string, number>;
}

export function createCooldownStore(): CooldownStore {
  return { hits: new Map() };
}

/**
 * Returns whether `key` may act now. On allow, records the hit (reserves the
 * window). On deny, reports the remaining cooldown in ms (does NOT slide the
 * window — a denied request can't extend its own lockout). Reserve on allow so
 * concurrent requests can't both pass; call clearCooldown to refund a reserved
 * window when the guarded action turned out to be a no-op.
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

/**
 * Refund a previously-reserved window so `key` may act again immediately. Use
 * when the rate-limited action was a no-op (e.g. a test push that reached zero
 * devices) — only real, throttle-worthy actions should hold the window.
 */
export function clearCooldown(store: CooldownStore, key: string): void {
  store.hits.delete(key);
}
