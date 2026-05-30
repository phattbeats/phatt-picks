/**
 * verify-news - offline proof for PHA-857 (HEAT wire / news feed).
 *
 * Exercises the pure news-core: seed normalization (drops blank/invalid),
 * pinned-first + newest-first sort, DB-over-seed merge dedup, and the
 * time-ago formatter. Also asserts the committed seed is empty by default so
 * the shipped Beta degrades to the honest "No signal yet" state.
 *
 * Run: node scripts/verify-news.ts
 */

import {
  COLOGNE_NEWS_SEED,
  normalizeSeed,
  seedWireItems,
  sortWire,
  mergeWire,
  timeAgo,
  type NewsSeedItem,
  type WireItem,
} from "../src/lib/news-core.ts";
import { parseHltvRss, HLTV_MAX_ITEMS } from "../src/lib/hltv-core.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name);
  }
}

console.log("\nnews-core - committed default (Beta degrades to empty)");
check("COLOGNE_NEWS_SEED is empty by default", COLOGNE_NEWS_SEED.length === 0);
check("seedWireItems() is empty by default", seedWireItems().length === 0);
check(
  "empty merge → empty wire (honest no-signal state)",
  mergeWire([], []).length === 0,
);

console.log("\nnews-core - seed normalization + validation");
const good: NewsSeedItem = {
  externalId: "a",
  headline: "  Cologne opens  ",
  summary: "  swiss stage live  ",
  sourceUrl: " https://x.test ",
  publishedAt: "2026-06-02T07:00:00Z",
};
const n = normalizeSeed(good)!;
check("valid seed normalizes", n !== null);
check("headline trimmed", n.headline === "Cologne opens");
check("summary trimmed", n.summary === "swiss stage live");
check("sourceUrl trimmed", n.sourceUrl === "https://x.test");
check("default source applied", n.source === "phatt");
check("publishedAt parsed to epoch ms", n.publishedAt === Date.parse("2026-06-02T07:00:00Z"));
check("imageUrl absent → null", n.imageUrl === null);
check("pinned defaults false", n.pinned === false);

check("blank externalId dropped", normalizeSeed({ ...good, externalId: "" }) === null);
check("blank headline dropped", normalizeSeed({ ...good, headline: "   " }) === null);
check(
  "invalid publishedAt dropped (no NaN timestamp)",
  normalizeSeed({ ...good, publishedAt: "not-a-date" }) === null,
);

console.log("\nnews-core - sort (pinned first, then newest)");
const items: WireItem[] = [
  { externalId: "old", source: "phatt", sourceUrl: null, headline: "old", summary: null, imageUrl: null, publishedAt: 1000, pinned: false },
  { externalId: "new", source: "phatt", sourceUrl: null, headline: "new", summary: null, imageUrl: null, publishedAt: 5000, pinned: false },
  { externalId: "pin", source: "phatt", sourceUrl: null, headline: "pin", summary: null, imageUrl: null, publishedAt: 2000, pinned: true },
];
const sorted = sortWire(items);
check("pinned leads even when older", sorted[0].externalId === "pin");
check("then newest-first", sorted[1].externalId === "new" && sorted[2].externalId === "old");

// Deterministic tie-break by externalId (no Date/random jitter).
const tie: WireItem[] = [
  { externalId: "b", source: "s", sourceUrl: null, headline: "b", summary: null, imageUrl: null, publishedAt: 3000, pinned: false },
  { externalId: "a", source: "s", sourceUrl: null, headline: "a", summary: null, imageUrl: null, publishedAt: 3000, pinned: false },
];
check("tie broken deterministically by externalId", sortWire(tie)[0].externalId === "a");

console.log("\nnews-core - merge (DB overrides seed by externalId)");
const seed: WireItem[] = [
  { externalId: "dup", source: "phatt", sourceUrl: null, headline: "seed copy", summary: null, imageUrl: null, publishedAt: 1000, pinned: false },
  { externalId: "seed-only", source: "phatt", sourceUrl: null, headline: "seed only", summary: null, imageUrl: null, publishedAt: 1500, pinned: false },
];
const db: WireItem[] = [
  { externalId: "dup", source: "hltv", sourceUrl: null, headline: "db copy", summary: null, imageUrl: null, publishedAt: 9000, pinned: false },
];
const merged = mergeWire(db, seed);
check("merge dedups by externalId", merged.length === 2);
const dup = merged.find((m) => m.externalId === "dup")!;
check("DB row wins over seed on conflict", dup.headline === "db copy" && dup.source === "hltv");
check("seed-only item retained", merged.some((m) => m.externalId === "seed-only"));

console.log("\nnews-core - time-ago");
const NOW = Date.parse("2026-06-02T12:00:00Z");
check("future → just now", timeAgo(NOW + 60_000, NOW) === "just now");
check("<60s → just now", timeAgo(NOW - 5_000, NOW) === "just now");
check("minutes", timeAgo(NOW - 5 * 60_000, NOW) === "5m ago");
check("hours", timeAgo(NOW - 3 * 3_600_000, NOW) === "3h ago");
check("days", timeAgo(NOW - 2 * 86_400_000, NOW) === "2d ago");
check("weeks", timeAgo(NOW - 14 * 86_400_000, NOW) === "2w ago");

// ---------------------------------------------------------------------------
// PHA-859 — HLTV RSS parse (hltv-core). Fixture mirrors the live HLTV feed shape
// (title/description/link/guid/pubDate/media:content) confirmed before building.
// ---------------------------------------------------------------------------

console.log("\nhltv-core - RSS parse → WireItem (map, image, dedup)");

const RSS = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>HLTV.org</title>
  <item>
    <title>FaZe &amp; magic reach grand final </title>
    <description>Twistzz's troops advance.</description>
    <link>https://www.hltv.org/news/44730/faze-grand-final</link>
    <guid isPermaLink="false">hltvnews44730</guid>
    <pubDate>Fri, 29 May 2026 20:30:00 GMT</pubDate>
    <media:content url="https://img-cdn.hltv.org/x.jpg?w=800&amp;q=75"></media:content>
  </item>
  <item>
    <title>NIP qualify for playoffs</title>
    <description><![CDATA[Big <b>upset</b> in group B.]]></description>
    <link>https://www.hltv.org/news/44731/nip-playoffs</link>
    <guid isPermaLink="false">hltvnews44731</guid>
    <pubDate>Fri, 29 May 2026 18:00:00 GMT</pubDate>
  </item>
</channel>
</rss>`;

const wire = parseHltvRss(RSS);
check("parses both well-formed items", wire.length === 2);

const first = wire[0];
check("headline decoded + trimmed", first.headline === "FaZe & magic reach grand final");
check("summary mapped", first.summary === "Twistzz's troops advance.");
check("source tagged hltv", first.source === "hltv");
check("externalId namespaced from guid", first.externalId === "hltv:hltvnews44730");
check("sourceUrl from link", first.sourceUrl === "https://www.hltv.org/news/44730/faze-grand-final");
check(
  "image from media:content, entities decoded",
  first.imageUrl === "https://img-cdn.hltv.org/x.jpg?w=800&q=75",
);
check("publishedAt parsed to epoch ms", first.publishedAt === Date.parse("Fri, 29 May 2026 20:30:00 GMT"));
check("automated items never pinned", first.pinned === false);

const second = wire[1];
check("CDATA description unwrapped", second.summary === "Big <b>upset</b> in group B.");
check("missing media:content → imageUrl null (framed placeholder)", second.imageUrl === null);

// Idempotent dedup: parsing the same feed twice yields identical stable keys,
// so the downstream upsert (where: externalId) overwrites rather than duplicates.
const again = parseHltvRss(RSS);
check(
  "re-parse yields identical externalIds (idempotent dedup)",
  again.map((w) => w.externalId).join(",") === wire.map((w) => w.externalId).join(","),
);

console.log("\nhltv-core - never fabricate (drop unusable rows)");
const BAD = `<rss><channel>
  <item><title>  </title><pubDate>Fri, 29 May 2026 20:30:00 GMT</pubDate><guid>g1</guid></item>
  <item><title>No date</title><pubDate>not-a-date</pubDate><guid>g2</guid></item>
  <item><title>No key</title><pubDate>Fri, 29 May 2026 20:30:00 GMT</pubDate></item>
  <item><title>Good one</title><pubDate>Fri, 29 May 2026 20:30:00 GMT</pubDate><guid>g4</guid></item>
</channel></rss>`;
const cleaned = parseHltvRss(BAD);
check("blank title / bad date / no-key items dropped", cleaned.length === 1);
check("only the usable item survives", cleaned[0]?.externalId === "hltv:g4");

console.log("\nhltv-core - resilience");
check("empty string → [] (no throw)", parseHltvRss("").length === 0);
check("garbage → [] (no throw)", parseHltvRss("<html>not rss</html>").length === 0);

// A single out-of-range numeric entity must not throw (would discard the whole
// pull). The bad entity is left verbatim; the item still parses.
const OOR = `<rss><channel><item><title>boom &#1114112; ok</title><pubDate>Fri, 29 May 2026 20:30:00 GMT</pubDate><guid>g1</guid></item></channel></rss>`;
let oorThrew = false;
let oorItems: WireItem[] = [];
try { oorItems = parseHltvRss(OOR); } catch { oorThrew = true; }
check("out-of-range numeric entity does not throw", !oorThrew);
check("item survives a bad entity (left verbatim)", oorItems.length === 1 && oorItems[0].headline.includes("&#1114112;"));

// Radix is driven by the `x` prefix, not the digits: &#x41; is hex 0x41 = 'A',
// &#65; is decimal 65 = 'A'. The old all-digits heuristic misread &#x41; as 41.
const ENT = `<rss><channel><item><title>&#x41;&#65;&#x2014;</title><pubDate>Fri, 29 May 2026 20:30:00 GMT</pubDate><guid>g2</guid></item></channel></rss>`;
check("hex (&#x41;) + decimal (&#65;) + em-dash decode correctly", parseHltvRss(ENT)[0]?.headline === "AA—");

// Feed flood guard: more than HLTV_MAX_ITEMS entries are capped.
const many = Array.from({ length: HLTV_MAX_ITEMS + 10 }, (_v, i) =>
  `<item><title>n${i}</title><pubDate>Fri, 29 May 2026 20:30:00 GMT</pubDate><guid>g${i}</guid></item>`,
).join("");
check("caps at HLTV_MAX_ITEMS", parseHltvRss(`<rss><channel>${many}</channel></rss>`).length === HLTV_MAX_ITEMS);

// Merge: an automated HLTV row coexists with curated seed, deduped by externalId.
const hltvAsDb = parseHltvRss(RSS);
const curated: WireItem[] = [
  { externalId: "phatt:pin", source: "phatt", sourceUrl: null, headline: "pinned", summary: null, imageUrl: null, publishedAt: Date.parse("2026-05-29T19:00:00Z"), pinned: true },
];
const mix = mergeWire(hltvAsDb, curated);
check("curated pinned leads merged wire", mix[0].externalId === "phatt:pin");
check("hltv rows merge in alongside seed", mix.length === 3);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
