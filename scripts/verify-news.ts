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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
