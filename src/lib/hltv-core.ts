/**
 * HLTV / CS2 RSS parsing (pure, PHA-859).
 *
 * The automated wire source greenlit on PHA-857. This module turns a raw RSS
 * document (HLTV's own `https://www.hltv.org/rss/news`, confirmed returning
 * `application/rss+xml` 200) into the same `WireItem[]` the curated seed
 * produces, so it flows through the existing `ingestNews` upsert and the rest of
 * the app stays source-agnostic (see [[phatt-picks-pha857-news-wire-state]]).
 *
 * Pure module by design — no `@/` alias, no prisma, no fetch, no XML dependency
 * (we have none in the tree). It is regex-driven over well-formed RSS so the
 * verify script can import it directly under `node`, exactly like news-core.
 *
 * Design rules inherited from the wire seam:
 *   - never fabricate: an item with a blank title or an unparseable pubDate is
 *     dropped, never coerced to a NaN timestamp or a placeholder headline;
 *   - `externalId` is a stable per-source key (the feed guid, or a hash of the
 *     link when no guid) prefixed `hltv:` so re-ingestion is idempotent and the
 *     hltv namespace can never collide with a curated seed slug;
 *   - `imageUrl` is pulled from media:content / enclosure / og:image when
 *     present, else null → the framed placeholder. We never invent an image.
 */

import type { WireItem } from "./news-core";

export const HLTV_SOURCE = "hltv";

/** Hard cap on items mapped from one feed pull — a feed gone wild can't flood. */
export const HLTV_MAX_ITEMS = 30;

/** Decode the handful of XML entities an RSS feed actually emits. */
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(x?)0*([0-9a-fA-F]+);/gi, (whole: string, hex: string, code: string) => {
      // Radix comes from the `x` prefix, never from whether the digits contain
      // a-f — otherwise a hex ref like &#x41; (all-decimal digits) is misread as
      // decimal. Out-of-range / invalid codepoints are left verbatim so a single
      // bad entity can't throw and discard the whole feed (parser stays total).
      const cp = parseInt(code, hex ? 16 : 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : whole;
    })
    .replace(/&amp;/g, "&") // last: so "&amp;lt;" → "&lt;" → "<" is avoided
    .trim();
}

/** Inner text of the first `<tag …>…</tag>` in `block`, or null if absent. */
function tagText(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

/** Value of `attr` on the first `<tag …>` in `block`, or null. */
function tagAttr(block: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*?\\b${attr}\\s*=\\s*"([^"]*)"`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

/** Stable djb2 hash → base36, for the externalId fallback when a guid is absent. */
function hashUrl(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** First non-empty image candidate: media:content → enclosure → og:image. */
function extractImage(block: string): string | null {
  const media = tagAttr(block, "media:content", "url");
  if (media) return media;
  const enclosure = tagAttr(block, "enclosure", "url");
  if (enclosure) return enclosure;
  const ogImage = tagAttr(block, "media:thumbnail", "url");
  if (ogImage) return ogImage;
  return null;
}

/**
 * Parse a raw RSS document into WireItems, newest items first as the feed
 * orders them. Source defaults to "hltv". Always total — a malformed document
 * yields [] rather than throwing, matching the graceful-degrade contract.
 */
export function parseHltvRss(
  xml: string,
  source: string = HLTV_SOURCE,
): WireItem[] {
  if (typeof xml !== "string" || xml.length === 0) return [];

  const items: WireItem[] = [];
  const blockRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  for (const m of xml.matchAll(blockRe)) {
    if (items.length >= HLTV_MAX_ITEMS) break;
    const block = m[1];

    const headline = (tagText(block, "title") ?? "").trim();
    if (headline.length === 0) continue; // never fabricate a headline

    const pub = tagText(block, "pubDate") ?? tagText(block, "dc:date");
    const ms = pub ? Date.parse(pub) : NaN;
    if (Number.isNaN(ms)) continue; // never coerce a NaN timestamp

    const link = tagText(block, "link");
    const guid = tagText(block, "guid");
    const key = (guid && guid.length > 0 ? guid : link ? hashUrl(link) : null);
    if (!key) continue; // no stable dedup key → skip rather than churn rows

    items.push({
      externalId: `${source}:${key}`,
      source,
      sourceUrl: link && link.length > 0 ? link : null,
      headline,
      summary: (tagText(block, "description") ?? "").trim() || null,
      imageUrl: extractImage(block),
      publishedAt: ms,
      pinned: false, // curated items lead the wire; automated pulls never pin
    });
    // NOTE: sourceUrl/imageUrl are NOT scheme-validated here — they are
    // sanitized at the read chokepoint (news-core mergeWire) and again at the
    // render sink (WireFeed). Keeping this module free of a *runtime* news-core
    // import preserves its bare-node loadability for the verify harness.
  }

  return items;
}
