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

export type BrowserFamily =
  | "edge"
  | "samsung"
  | "opera"
  | "chrome"
  | "firefox"
  | "safari"
  | "other";

/** Coarse browser family from a UA string. Order matters — Edge/Opera/Samsung
 *  all embed "chrome", and Chrome embeds "safari", so check the specific ones
 *  first. Never a version or fingerprint. */
export function browserFamily(ua: string | null | undefined): BrowserFamily {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "other";
  if (/edg(a|ios|e)?\//.test(s)) return "edge";
  if (/samsungbrowser/.test(s)) return "samsung";
  if (/opr\/|opera|opt\//.test(s)) return "opera";
  if (/firefox|fxios/.test(s)) return "firefox";
  if (/chrome|crios|chromium/.test(s)) return "chrome";
  if (/safari|applewebkit/.test(s)) return "safari";
  return "other";
}

export type OsFamily =
  | "ios"
  | "android"
  | "windows"
  | "macos"
  | "linux"
  | "other";

/** Coarse OS family from a UA string. iOS before macOS (iPads can say
 *  "Macintosh"), Android before Linux (Android UAs contain "Linux"). */
export function osFamily(ua: string | null | undefined): OsFamily {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "other";
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  if (/android/.test(s)) return "android";
  if (/windows|win64|win32/.test(s)) return "windows";
  if (/mac os x|macintosh/.test(s)) return "macos";
  if (/linux|x11|cros/.test(s)) return "linux";
  return "other";
}

/** 2-letter ISO country, uppercased. Rejects Cloudflare's non-country sentinels
 *  ("XX" unknown, "T1" Tor) and anything that isn't two letters. */
export function sanitizeCountry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  if (c === "XX" || c === "T1") return null;
  return c;
}

/** Event name: lowercase slug only ([a-z0-9_-], <=40). Keeps the events table a
 *  small controlled vocabulary, never free text. */
export function sanitizeEvent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(e)) return null;
  return e;
}

/** Optional event label (e.g. a disclosure's summary text). Collapses
 *  whitespace + control chars and caps length — the caller only ever passes UI
 *  strings, so this is descriptive, not PII. */
export function sanitizeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const l = raw.replace(/\s+/g, " ").trim();
  if (!l) return null;
  return l.slice(0, 80);
}

/** Map a raw scroll percentage to a coarse depth bucket. */
export function scrollBucket(pct: unknown): 25 | 50 | 75 | 100 | null {
  const n = typeof pct === "number" ? pct : Number(pct);
  if (!Number.isFinite(n) || n < 25) return null;
  if (n >= 100) return 100;
  if (n >= 75) return 75;
  if (n >= 50) return 50;
  return 25;
}

export interface ViewLike {
  visitor: string | null;
  path: string;
  createdAt: Date;
}
export interface SessionSummary {
  visitor: string;
  entryPath: string;
  exitPath: string;
  start: Date;
  end: Date;
  views: number;
}

/**
 * Group pageviews into sessions (pure, so it's verifiable). A session is a run
 * of one visitor's views with no gap longer than `gapMs` (default 30 min). Rows
 * with a null visitor are ignored (can't be attributed). Returns one summary per
 * session — the basis for unique visitors, bounce rate, duration, entry/exit.
 */
export function sessionize(
  views: ViewLike[],
  gapMs = 30 * 60 * 1000,
): SessionSummary[] {
  const byVisitor = new Map<string, ViewLike[]>();
  for (const v of views) {
    if (!v.visitor) continue;
    const arr = byVisitor.get(v.visitor) ?? [];
    arr.push(v);
    byVisitor.set(v.visitor, arr);
  }
  const sessions: SessionSummary[] = [];
  for (const [visitor, rows] of byVisitor) {
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let cur: SessionSummary | null = null;
    for (const r of rows) {
      if (cur && r.createdAt.getTime() - cur.end.getTime() <= gapMs) {
        cur.end = r.createdAt;
        cur.exitPath = r.path;
        cur.views += 1;
      } else {
        if (cur) sessions.push(cur);
        cur = {
          visitor,
          entryPath: r.path,
          exitPath: r.path,
          start: r.createdAt,
          end: r.createdAt,
          views: 1,
        };
      }
    }
    if (cur) sessions.push(cur);
  }
  return sessions;
}
