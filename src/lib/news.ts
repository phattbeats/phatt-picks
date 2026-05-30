/**
 * Wire / news data access (server-only, PHA-857).
 *
 * `getWireItems` is the read path for /news + the dashboard Wire panel. It
 * merges any ingested NewsItem rows with the committed curated seed and returns
 * them newest-first. It NEVER throws to the caller: if the NewsItem table is
 * missing (deploy hasn't run `prisma db push`) or the DB is unreachable, it
 * degrades to the seed alone, which itself may be empty → honest empty state.
 *
 * `ingestNews` is the write path. Today it upserts the committed seed (idempotent
 * by externalId). It is the single hook point for an automated source: a future
 * RSS / HLTV pull resolves to the same `WireItem[]` and flows through the same
 * upsert, so the rest of the app is source-agnostic. Like outcome ingestion it
 * is safe to call repeatedly and makes zero external calls today.
 */

import { prisma } from "./db";
import {
  type WireItem,
  mergeWire,
  seedWireItems,
  sortWire,
} from "./news-core";

/** Read the wire, newest-first, capped at `limit`. Never throws. */
export async function getWireItems(limit = 30): Promise<WireItem[]> {
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

export type IngestNewsSummary = {
  upserted: number;
  source: "seed";
};

/**
 * Upsert the committed curated seed into NewsItem (idempotent by externalId).
 * The hook point for an automated pull: resolve external stories to
 * `WireItem[]` and upsert them here too.
 */
export async function ingestNews(): Promise<IngestNewsSummary> {
  const items = seedWireItems();
  for (const it of items) {
    await prisma.newsItem.upsert({
      where: { externalId: it.externalId },
      create: {
        externalId: it.externalId,
        source: it.source,
        sourceUrl: it.sourceUrl,
        headline: it.headline,
        summary: it.summary,
        imageUrl: it.imageUrl,
        publishedAt: new Date(it.publishedAt),
        pinned: it.pinned,
      },
      update: {
        source: it.source,
        sourceUrl: it.sourceUrl,
        headline: it.headline,
        summary: it.summary,
        imageUrl: it.imageUrl,
        publishedAt: new Date(it.publishedAt),
        pinned: it.pinned,
      },
    });
  }
  return { upserted: items.length, source: "seed" };
}
