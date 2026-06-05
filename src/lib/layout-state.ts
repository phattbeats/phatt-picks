/**
 * Live-layout persistence + overlay (server-only) — PHA-896.
 *
 * The picks UI read `getCommittedLayout()` everywhere and never merged live team
 * data, so Stage III showed only its 8 pre-known teams (the 8 Stage-II advancers
 * stayed `pickid:0`) and every playoff slot stayed TBD — locked as
 * `teams-not-set` forever, with the write side rejecting on an empty eligibility
 * set. Valve already serves the seeded teams in GetTournamentLayout; we just
 * weren't keeping them.
 *
 * This module mirrors the outcomes / rank-snapshot pattern: a DB-backed cache
 * (`LayoutCache`) refreshed on-read behind a throttle, and an overlay read
 * (`getEffectiveLayout`) that folds the live `group.teams` + `picks_allowed` onto
 * the committed fixture (see layout-merge-core). Graceful by contract (rules
 * #7/#8): every path degrades to the bare fixture on a miss/error — a cold cache
 * is exactly the prior behavior, never a crash.
 */

import { after } from "next/server";
import { prisma } from "./db";
import { parseSafeJson } from "./bigint";
import { getCommittedLayout, type Layout, type LayoutEnvelope } from "./layout";
import { mergeLiveLayout } from "./layout-merge-core";
import { fetchTournamentLayout } from "./valve";

/**
 * Persist the live layout envelope for an event. Idempotent upsert keyed by
 * eventId. bigint-safe: fetchTournamentLayout already parsed itemids to strings
 * (rule #2), so JSON.stringify of the parsed result keeps them as strings.
 * Non-fatal: a write failure logs and returns — the read path still has the
 * fixture (and whatever was cached before).
 */
export async function cacheLiveLayout(
  eventId: number,
  envelope: LayoutEnvelope | null | undefined,
): Promise<void> {
  const live = envelope?.result;
  if (!live?.sections) return;
  const data = JSON.stringify(live);
  try {
    await prisma.layoutCache.upsert({
      where: { eventId },
      update: { data, fetchedAt: new Date() },
      create: { eventId, data },
    });
  } catch (e) {
    console.error("[layout-state] cacheLiveLayout failed (non-fatal):", e);
  }
}

/** Read the cached live layout for an event, or null. Degrades to null on any error. */
async function readCachedLayout(eventId: number): Promise<Layout | null> {
  try {
    const row = await prisma.layoutCache.findUnique({ where: { eventId } });
    if (!row) return null;
    return (parseSafeJson(row.data) as Layout) ?? null;
  } catch (e) {
    console.error("[layout-state] readCachedLayout failed (degrading to fixture):", e);
    return null;
  }
}

/**
 * The committed fixture with the live `group.teams` + `picks_allowed` overlaid
 * from the cached layout. This is what the pick pool (PicksBoard) and the
 * write-side eligibility check (validatePickAgainstLayout) must read so the
 * Stage-III advancers and the playoff bracket become pickable as Valve seeds
 * them. Degrades to the bare fixture when nothing is cached yet.
 */
export async function getEffectiveLayout(eventId: number): Promise<Layout> {
  const committed = getCommittedLayout();
  const live = await readCachedLayout(eventId);
  return mergeLiveLayout(committed, live);
}

// Dedicated refresh slot — gates how often a live-layout fetch is *attempted*
// across the whole cluster, independent of the outcomes refresh (PHA-866) so a
// fully-resolved event that has stopped polling outcomes still tracks late
// playoff seeding. 30s floor matches the outcomes cadence.
const LAYOUT_REFRESH_SOURCE = "layout-refresh";
const LAYOUT_REFRESH_MIN_INTERVAL_MS = 30_000;

/**
 * Atomically claim the layout refresh slot — mirrors claimOutcomesRefreshSlot
 * (PHA-866). Returns true iff the 30s floor has elapsed (or no row exists) AND
 * this caller won the race; under concurrency exactly one caller wins. Any DB
 * error resolves to "allowed" so a storage hiccup never permanently blocks the
 * driver.
 */
async function claimLayoutRefreshSlot(): Promise<boolean> {
  const now = new Date();
  const floor = new Date(now.getTime() - LAYOUT_REFRESH_MIN_INTERVAL_MS);
  try {
    const res = await prisma.sourceState.updateMany({
      where: { source: LAYOUT_REFRESH_SOURCE, lastCallAt: { lt: floor } },
      data: { lastCallAt: now },
    });
    if (res.count > 0) return true; // won the slot: floor had elapsed
    const inserted = await prisma.$executeRaw`
      INSERT OR IGNORE INTO "SourceState" ("source", "lastCallAt")
      VALUES (${LAYOUT_REFRESH_SOURCE}, ${now})
    `;
    return inserted > 0; // 1 = first-ever refresh; 0 = within floor or lost the race
  } catch {
    return true; // DB hiccup — don't let storage permanently block the driver
  }
}

/**
 * On-read self-refresh of the live layout (mirrors refreshOutcomesOnRead). The
 * picks surface calls this so the pool / stage gate track Valve's seeding as
 * stages resolve, with NO external cron. One ATOMIC claim gates the whole
 * refresh against the 30s floor — lose it → no-op; win it → DEFER the slow Valve
 * fetch past the response via `after` so it never adds to page latency. The
 * deferred fetch caches the envelope; the NEXT render reads the seeded teams.
 * Never throws.
 */
export async function refreshLayoutOnRead(eventId: number): Promise<void> {
  if (!(await claimLayoutRefreshSlot())) return; // within floor or lost the race — no-op
  runDeferred(async () => {
    const envelope = await fetchTournamentLayout(eventId);
    await cacheLiveLayout(eventId, envelope);
  });
}

/**
 * Run a best-effort background task without blocking (or coupling latency to)
 * the current render. Prefers Next's `after`; falls back to a floating promise
 * outside a request scope. Errors are swallowed — the driver is best-effort.
 */
function runDeferred(task: () => Promise<unknown>): void {
  const run = () => {
    void task().catch((e) => console.error("[layout-state] deferred refresh failed (non-fatal):", e));
  };
  try {
    after(run);
  } catch {
    run();
  }
}
