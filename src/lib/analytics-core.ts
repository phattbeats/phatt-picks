/**
 * analytics-core — pure helpers for the built-in, privacy-friendly pageview
 * counter (PHA-1277). No DB, no framework — just the sanitization + bucketing
 * rules so they can be unit-verified offline (scripts/verify-analytics.ts).
 *
 * Privacy by construction: we only ever derive a normalized internal path, a
 * coarse device class, and the *host* of an external referrer. No IP, no user
 * id, no query strings, no cookies — nothing that identifies a person or a pick.
 */

export type DeviceClass = "mobile" | "tablet" | "desktop";

/**
 * Coarse device bucket from a User-Agent string. Deliberately rough — we want
 * "mobile vs tablet vs desktop", never a fingerprint. Order matters: tablets
 * (iPad / Android-without-"mobile") are checked before phones.
 */
export function deviceClass(ua: string | null | undefined): DeviceClass {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "desktop";
  if (/ipad|playbook|silk|(android(?!.*mobile))|tablet/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone|iemobile|blackberry/.test(s)) {
    return "mobile";
  }
  return "desktop";
}

/**
 * Normalize a reported path into something safe to store and group on:
 *   - must be an internal absolute path ("/...") — anything else is rejected,
 *   - query string and hash are stripped (they can carry PII / tokens),
 *   - a trailing slash is removed so "/faq" and "/faq/" count as one route,
 *   - length is capped.
 * Returns null when the input can't be trusted as an internal route.
 */
export function sanitizePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.split(/[?#]/)[0].trim();
  if (!p.startsWith("/")) return null;
  // Collapse accidental double slashes and strip a trailing slash (keep root).
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p.length > 256) p = p.slice(0, 256);
  return p || "/";
}

/**
 * Reduce a referrer URL to just its host — never the full URL (which could leak
 * a path/query). Internal navigations (same host) and empty/invalid referrers
 * return null ("direct"), so the dashboard only shows genuine external sources.
 */
export function sanitizeReferrer(
  raw: unknown,
  selfHost = "pickems.phatt.vip",
): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (!host || host === selfHost) return null;
    return host.slice(0, 128);
  } catch {
    return null;
  }
}
