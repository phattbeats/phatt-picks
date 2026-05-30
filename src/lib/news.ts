/**
 * Wire / news data access (server-only, PHA-857).
 *
 * `getWireItems` is the read path for /news + the dashboard Wire panel. It
 * merges any ingested NewsItem rows with the committed curated seed and returns
 * them newest-first. It NEVER throws to the caller: if the NewsItem table is
 * missing (deploy hasn't run `prisma db push`) or the DB is unreachable, it
 * degrades to the seed alone, which itself may be empty → honest empty state.
 *
 * `ingestNews` is the write path. It upserts the committed curated seed
 * (idempotent by externalId) and then attempts the automated HLTV RSS pull
 * (PHA-859), upserting whatever it resolves through the SAME path. Both sources
 * resolve to the same `WireItem[]`, so the rest of the app stays
 * source-agnostic. The automated pull is best-effort: a throttle or a source
 * outage degrades to "seed only" and is reported in the summary — it never
 * throws into the caller. Safe to call repeatedly.
 */

import { prisma } from "./db";
import {
  type WireItem,
  mergeWire,
  seedWireItems,
  sortWire,
} from "./news-core";
import { fetchHltvWire, HltvThrottledError } from "./hltv";

/**
 * Read the wire, newest-first, capped at `limit`. Never throws.
 *
 * Triggers a best-effort self-refresh first so the wire stays populated with
 * zero ops — no external cron is needed for the closed alpha (and the ingest
 * route is session-gated, so a headless scheduler can't drive it anyway).
 * `ingestNews` self-throttles via the persisted 5-min HLTV floor and never
 * throws, so this is a no-network no-op when warm and degrades silently to the
 * existing rows + seed on a source outage. (PHA-859 / alpha.)
 */
export async function getWireItems(limit = 30): Promise<WireItem[]> {
  await ingestNews().catch(() => {}); // belt-and-suspenders; ingestNews already never throws
  const seed = seedWireItems();
  let dbItems: WireItem[] = [];
  try {
    const rows = await prisma.newsItem.findMany({
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      take: Math.max(limit, 50),
    });
    dbItems = rows.map((r) => ({
      externalId: r.externalId,
      source: r.source,
      sourceUrl: r.sourceUrl,
      headline: r.headline,
      summary: r.summary,
      imageUrl: r.imageUrl,
      publishedAt: r.publishedAt.getTime(),
      pinned: r.pinned,
    }));
  } catch {
    // Table absent (pre-migration) or DB hiccup — fall back to the seed alone.
    return sortWire(seed).slice(0, limit);
  }
  return mergeWire(dbItems, seed).slice(0, limit);
}

/** Outcome of the best-effort automated pull, surfaced in the summary. */
export type AutomatedPullSummary = {
  source: "hltv";
  /** ok = pulled & upserted; throttled = refresh floor blocked it; empty = feed
   *  had no usable items; error = network / non-200 (e.g. Cloudflare gate). */
  status: "ok" | "throttled" | "empty" | "error";
  fetched: number;
  upserted: number;
  detail?: string;
};

export type IngestNewsSummary = {
  /** Total rows upserted across all sources this run. */
  upserted: number;
  seedUpserted: number;
  automated: AutomatedPullSummary;
};

/** Upsert WireItems into NewsItem (idempotent by externalId). Returns the count. */
async function upsertWireItems(items: readonly WireItem[]): Promise<number> {
  for (const it of items) {
    const fields = {
      source: it.source,
      sourceUrl: it.sourceUrl,
      headline: it.headline,
      summary: it.summary,
      imageUrl: it.imageUrl,
      publishedAt: new Date(it.publishedAt),
      pinned: it.pinned,
    };
    await prisma.newsItem.upsert({
      where: { externalId: it.externalId },
      create: { externalId: it.externalId, ...fields },
      update: fields,
    });
  }
  return items.length;
}

/**
 * Run the automated HLTV pull and upsert it. Best-effort: a throttle, an empty
 * feed, or a source outage all resolve to a reported status, never a throw —
 * the curated seed is the floor the wire always has. Callers (the cron/routine)
 * should treat a `throttled` or `empty` status as authoritative and back off.
 */
async function ingestAutomated(): Promise<AutomatedPullSummary> {
  try {
    const items = await fetchHltvWire();
    if (items.length === 0) return { source: "hltv", status: "empty", fetched: 0, upserted: 0 };
    const upserted = await upsertWireItems(items);
    return { source: "hltv", status: "ok", fetched: items.length, upserted };
  } catch (e) {
    if (e instanceof HltvThrottledError) {
      return { source: "hltv", status: "throttled", fetched: 0, upserted: 0 };
    }
    // Source outage / Cloudflare gate — degrade to seed-only, report, don't throw.
    return {
      source: "hltv",
      status: "error",
      fetched: 0,
      upserted: 0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Upsert the committed curated seed, then attempt the automated HLTV pull.
 * Idempotent by externalId; the automated pull is rate-limited and degrades
 * gracefully (see ingestAutomated).
 */
export async function ingestNews(): Promise<IngestNewsSummary> {
  const seedUpserted = await upsertWireItems(seedWireItems());
  const automated = await ingestAutomated();
  return {
    upserted: seedUpserted + automated.upserted,
    seedUpserted,
    automated,
  };
}
