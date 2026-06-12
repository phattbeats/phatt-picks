/**
 * Wire / news feed core (pure, PHA-857).
 *
 * The mockup-17 wire is a populated headline feed (source · time-ago meta,
 * headline, image slot). News was cut from the Beta floor, so the design rule
 * mirrors the lock-schedule (PHA-856): never fabricate a headline. The wire is
 * driven by a real source — a committed *curated* seed for the Beta, and, when
 * wired, an automated pull (RSS / HLTV) through the same ingestion path. When
 * both the DB and the seed are empty the page degrades to the honest
 * "No signal yet" state instead of inventing content.
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under `node`, and so the seed config lives next to the
 * logic that validates it — same shape as lock-schedule-core.
 */

/** Stored / ingested wire row, normalized for rendering. */
export type WireItem = {
  externalId: string;
  source: string;
  sourceUrl: string | null;
  headline: string;
  summary: string | null;
  imageUrl: string | null;
  /** epoch ms — drives time-ago + sort. */
  publishedAt: number;
  pinned: boolean;
};

/**
 * Committed curated seed entry. `publishedAt` is an ISO-8601 instant (the pure
 * module can't call Date.now()); items with a missing/invalid instant or blank
 * headline are dropped by `normalizeSeed`, so a typo degrades to "fewer
 * headlines", never a crash or a NaN timestamp.
 */
export type NewsSeedItem = {
  /** Stable dedup key — keep it unique + immutable once published. */
  externalId: string;
  source?: string;
  sourceUrl?: string;
  headline: string;
  summary?: string;
  imageUrl?: string;
  publishedAt: string; // ISO-8601, e.g. "2026-06-02T14:00:00Z"
  pinned?: boolean;
};

/**
 * Committed IEM Cologne 2026 curated wire seed.
 *
 * EMPTY by default — an empty seed + empty NewsItem table is what renders the
 * honest "No signal yet" empty state. Curate by adding entries here, e.g.
 *   {
 *     externalId: "cologne-opener-2026",
 *     source: "phatt",
 *     headline: "Cologne opens: Stage I picks lock at 09:00 CEST",
 *     summary: "The Swiss stage is live...",
 *     sourceUrl: "https://...",
 *     imageUrl: "/news/cologne-opener.jpg", // optional; omit for the framed slot
 *     publishedAt: "2026-06-02T07:00:00Z",
 *     pinned: true,
 *   },
 * Entries appear on /news + the dashboard Wire panel immediately on deploy — no
 * ingestion run required (they are merged with any DB rows at read time).
 */
export const COLOGNE_NEWS_SEED: readonly NewsSeedItem[] = [
  // (curated headlines go here)
];

const DEFAULT_SOURCE = "phatt";

/**
 * Allow only safe URL shapes for the hrefs + image backgrounds the wire renders:
 * absolute http(s) URLs and same-origin root-relative paths (the curated seed
 * uses e.g. "/news/x.jpg"). Everything else — `javascript:`, `data:`,
 * `vbscript:`, protocol-relative `//host` — collapses to null. Wire items are
 * sourced from attacker-influenceable RSS (HLTV `<link>` / `<media:content url>`),
 * and React renders a `javascript:` href verbatim, so an unvalidated sourceUrl is
 * a stored-XSS sink. This is the shared guard applied at ingest, at seed
 * normalization, AND at the render sink (PHA-860 review, defense-in-depth).
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length === 0) return null;
  // Same-origin root-relative path — but not protocol-relative "//host".
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try {
    const proto = new URL(s).protocol;
    return proto === "http:" || proto === "https:" ? s : null;
  } catch {
    return null; // not an absolute URL with a parseable scheme → reject
  }
}

/** Normalize + validate one seed entry → WireItem, or null when unusable. */
export function normalizeSeed(seed: NewsSeedItem): WireItem | null {
  if (!seed || typeof seed.externalId !== "string" || seed.externalId.length === 0) {
    return null;
  }
  const headline = typeof seed.headline === "string" ? seed.headline.trim() : "";
  if (headline.length === 0) return null;

  const ms = Date.parse(seed.publishedAt);
  if (Number.isNaN(ms)) return null;

  return {
    externalId: seed.externalId,
    source: seed.source?.trim() || DEFAULT_SOURCE,
    sourceUrl: safeHttpUrl(seed.sourceUrl),
    headline,
    summary: seed.summary?.trim() || null,
    imageUrl: safeHttpUrl(seed.imageUrl),
    publishedAt: ms,
    pinned: seed.pinned === true,
  };
}

/** All committed seed items that survive validation. */
export function seedWireItems(
  seed: readonly NewsSeedItem[] = COLOGNE_NEWS_SEED,
): WireItem[] {
  return seed.map(normalizeSeed).filter((x): x is WireItem => x !== null);
}

/**
 * Pinned-first, then newest-first. Stable on ties via externalId so the order
 * is deterministic across renders (no Math.random / Date jitter).
 */
export function sortWire(items: readonly WireItem[]): WireItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.publishedAt !== a.publishedAt) return b.publishedAt - a.publishedAt;
    return a.externalId.localeCompare(b.externalId);
  });
}

/**
 * Re-validate a stored/ingested item's URLs at read time. DB rows (incl.
 * automated HLTV pulls) bypass `normalizeSeed`, and rows ingested before this
 * guard existed may carry a hostile `javascript:`/`data:` URL — so the read
 * path is the chokepoint that guarantees nothing unsafe reaches the renderer,
 * with no DB migration required. (PHA-860 review.)
 */
function sanitizeWireUrls(it: WireItem): WireItem {
  const sourceUrl = safeHttpUrl(it.sourceUrl);
  const imageUrl = safeHttpUrl(it.imageUrl);
  return sourceUrl === it.sourceUrl && imageUrl === it.imageUrl
    ? it
    : { ...it, sourceUrl, imageUrl };
}

/**
 * Merge DB rows with the committed seed, deduped by externalId. DB rows win
 * (they may carry edits / an automated pull's freshest copy), then sorted.
 * Every returned item's URLs are scheme-validated (see sanitizeWireUrls).
 */
export function mergeWire(
  dbItems: readonly WireItem[],
  seedItems: readonly WireItem[] = seedWireItems(),
): WireItem[] {
  const byId = new Map<string, WireItem>();
  for (const s of seedItems) byId.set(s.externalId, s);
  for (const d of dbItems) byId.set(d.externalId, d); // DB overrides seed
  return sortWire([...byId.values()].map(sanitizeWireUrls));
}

/** Compact human "time-ago" for the wire meta line. */
export function timeAgo(publishedAtMs: number, nowMs: number): string {
  const diff = nowMs - publishedAtMs;
  if (!Number.isFinite(diff)) return "";
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}
