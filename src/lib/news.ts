/**
 * Wire / news data access (server-only, PHA-857).
 *
 * `getWireItems` is the read path for /news + the dashboard Wire panel. It
 * merges any ingested NewsItem rows with the committed curated seed and returns
 * them newest-first. It NEVER throws to the caller: if the NewsItem table is
 * missing (deploy hasn't run `prisma db push`) or the DB is unreachable, it
 * degrades to the seed alone, which itself may be empty → honest empty state.
 * It also fires a best-effort self-refresh that is gated by ONE atomic floor
 * claim and defers the slow HLTV network pull off the render path (PHA-863), so
 * a render never blocks on the network and concurrent renders don't stampede.
 *
 * `ingestNews` is the owner-triggered write path (`/api/news/ingest`). It
 * upserts the committed curated seed (idempotent by externalId) and then
 * attempts the automated HLTV RSS pull (PHA-859), upserting whatever it resolves
 * through the SAME path. Both sources resolve to the same `WireItem[]`, so the
 * rest of the app stays source-agnostic. It bypasses the floor (force) and the
 * automated pull is best-effort: a source outage degrades to "seed only" and is
 * reported in the summary — it never throws into the caller. Safe to call
 * repeatedly.
 */

import { after } from "next/server";
import { prisma } from "./db";
import {
  type WireItem,
  mergeWire,
  seedWireItems,
  sortWire,
} from "./news-core";
import { claimRefreshSlot, fetchHltvWire, stampRefreshSlot } from "./hltv";

/**
 * Read the wire, newest-first, capped at `limit`. Never throws.
 *
 * Triggers a best-effort self-refresh first so the wire stays populated with
 * zero ops — no external cron is needed for the closed alpha (and the ingest
 * route is session-gated, so a headless scheduler can't drive it anyway). The
 * refresh is gated by a single atomic floor claim and the slow HLTV network
 * pull is deferred off the render path, so a render never blocks on the network
 * and concurrent renders don't stampede the DB. (PHA-859 / PHA-863 / alpha.)
 */
export async function getWireItems(limit = 30): Promise<WireItem[]> {
  await refreshWireOnRead().catch(() => {}); // belt-and-suspenders; already never throws
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
  /** ok = pulled & upserted; empty = feed had no usable items; error = network /
   *  non-200 (e.g. Cloudflare gate). The refresh floor is gated upstream by
   *  claimRefreshSlot (PHA-863), so an attempted pull is never "throttled" here. */
  status: "ok" | "empty" | "error";
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
  if (items.length === 0) return 0; // skip when empty — nothing to write
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
 * Run the automated HLTV pull and upsert it. Best-effort: an empty feed or a
 * source outage resolve to a reported status, never a throw — the curated seed
 * is the floor the wire always has. The refresh floor is decided by the caller
 * (claimRefreshSlot) before we get here, so there is no `throttled` path: this
 * always attempts the pull. (PHA-863.)
 */
async function ingestAutomated(): Promise<AutomatedPullSummary> {
  try {
    const items = await fetchHltvWire();
    if (items.length === 0) return { source: "hltv", status: "empty", fetched: 0, upserted: 0 };
    const upserted = await upsertWireItems(items);
    return { source: "hltv", status: "ok", fetched: items.length, upserted };
  } catch (e) {
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
 * Best-effort self-refresh fired from the read path (PHA-863). One atomic claim
 * gates the whole refresh against the 5-min floor: lose the claim → no-op (warm
 * window or a concurrent render already holds it). Win it → upsert the curated
 * seed inline (fast, local — keeps a cold window non-empty) and DEFER the slow
 * HLTV network pull past the response so it never adds to page latency. The slot
 * is already stamped by the claim, so concurrent/subsequent renders back off
 * regardless of when the deferred pull finishes. Never throws.
 */
async function refreshWireOnRead(): Promise<void> {
  if (!(await claimRefreshSlot())) return; // within floor or lost the race — no-op
  await upsertWireItems(seedWireItems()).catch(() => {}); // local + fast; skips when empty
  runDeferred(() => ingestAutomated()); // slow network pull — off the render path
}

/**
 * Run a best-effort background task without blocking (or coupling latency to) the
 * current render. Prefers Next's `after` so the work runs past the response and
 * isn't cut off; falls back to a floating promise when called outside a request
 * scope (e.g. tests). Errors are swallowed — callers are all best-effort.
 */
function runDeferred(task: () => Promise<unknown>): void {
  const run = () => {
    void task().catch(() => {});
  };
  try {
    after(run);
  } catch {
    run();
  }
}

/**
 * Force a full synchronous refresh: upsert the committed curated seed, then
 * attempt the automated HLTV pull, and stamp the floor so the read path backs
 * off afterward. Bypasses the floor on purpose — this is the owner-triggered
 * entry point (`/api/news/ingest`). Idempotent by externalId; the automated pull
 * degrades gracefully (see ingestAutomated). (PHA-859 / PHA-863.)
 */
export async function ingestNews(): Promise<IngestNewsSummary> {
  const seedUpserted = await upsertWireItems(seedWireItems());
  const automated = await ingestAutomated();
  await stampRefreshSlot(); // make the read path back off after a manual refresh
  return {
    upserted: seedUpserted + automated.upserted,
    seedUpserted,
    automated,
  };
}
