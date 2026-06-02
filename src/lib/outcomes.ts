/**
 * Outcome ingestion (server-only).
 *
 * Resolves stage results into the StageOutcome table, which the leaderboard
 * scores against. Source precedence (spec):
 *   1. Valve oracle — IF the running event exposes results. Probed first.
 *   2. Liquipedia MediaWiki API — fallback. Polite client in ./liquipedia.
 *
 * "Cache hard": a finished match never changes, so a resolved StageOutcome row
 * is terminal. We compute the set of still-unresolved slots from the layout vs.
 * the DB and only query a source when something is actually missing — once the
 * tournament fully resolves we stop calling out entirely. Combined with the
 * per-source rate limiter, this keeps us well inside Liquipedia's API terms.
 *
 * Graceful by contract (rules #7/#8): a source outage logs and returns what we
 * already have; it never throws into the request path or wipes stored results.
 */

import { after } from "next/server";
import { prisma } from "./db";
import { getCommittedLayout } from "./layout";
import {
  normalizeOutcomes,
  pickLockedUnresolvedSlots,
  resolveOutcomesFromLayout,
  type NormalizedOutcome,
  type RawResolvedSlot,
} from "./outcomes-core";
import { fetchLiquipediaResults, LiquipediaThrottledError } from "./liquipedia";
import { fetchTournamentLayout } from "./valve";
import { writeRankSnapshots } from "./rank-snapshot";
import { isLockTimePassed } from "./lock-schedule-core";

export interface IngestSummary {
  eventId: number;
  source: "valve" | "liquipedia" | "none";
  resolvedBefore: number;
  resolvedAfter: number;
  written: number;
  rejected: number;
  error?: string;
  /** Why no source call happened — set when source === "none". */
  reason?: "no-locked-unresolved" | "fully-resolved" | "throttled" | "source-error";
}

/**
 * Probe the Valve oracle for resolved results (PHA-869 — Brandon-approved source).
 *
 * Valve's GetTournamentLayout carries the official answer key in each pick slot's
 * `pickids` once a stage resolves (empty pre-event). This is the preferred,
 * slot-correct source: we read results from the very layout players picked into,
 * so no external slot-ordering guess is needed (the reason Liquipedia can't
 * resolve the set-valued Swiss buckets). resolveOutcomesFromLayout applies the
 * per-slot policy (single pickid → resolved; multi → ambiguous, left for live
 * confirmation; locked groups only).
 *
 * Graceful by contract (rules #7/#8): any failure — STEAM_API_KEY unset, a
 * non-200, an unparseable body — logs and returns null so ingest falls through
 * to the Liquipedia fallback and never throws into the read/request path.
 * Returns null (not []) when nothing is resolved so the caller treats "Valve had
 * nothing" the same as "Valve unavailable" and still consults the fallback.
 *
 * NOTE: the resolved `pickids` shape can only be confirmed against real data at
 * the stage-1 opener (Jun 2) — pre-event every slot is empty, so this path is a
 * structural no-op until then (proven offline by verify-outcomes-oracle).
 */
async function tryValveOracle(eventId: number): Promise<RawResolvedSlot[] | null> {
  try {
    const envelope = await fetchTournamentLayout(eventId);
    const live = envelope?.result;
    if (!live?.sections) return null;
    const { resolved, ambiguous } = resolveOutcomesFromLayout(live);
    if (ambiguous.length > 0) {
      console.warn(
        `[outcomes] Valve layout reported ${ambiguous.length} slot(s) with multiple ` +
          `correct pickids (bucket/set semantics) — left unresolved pending live ` +
          `confirmation at the stage-1 opener:`,
        ambiguous,
      );
    }
    return resolved.length > 0 ? resolved : null;
  } catch (e) {
    console.error(
      "[outcomes] Valve oracle (GetTournamentLayout) failed (non-fatal):",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Ingest outcomes for an event. Only fetches when unresolved slots remain.
 * Idempotent: re-running after full resolution is a no-op (no network call).
 */
export async function ingestOutcomes(eventId: number): Promise<IngestSummary> {
  const layout = getCommittedLayout();

  const existing = await prisma.stageOutcome.findMany({
    where: { eventId },
    select: { sectionId: true, groupId: true, slotIndex: true },
  });
  const resolvedKey = new Set(existing.map((o) => `${o.sectionId}:${o.groupId}:${o.slotIndex}`));
  const resolvedBefore = resolvedKey.size;

  // Gate on stage state, not just resolved rows. Only stages whose pick window
  // has CLOSED can have results — pre-event every stage is open, so this is []
  // and we never touch the source (PHA-844: the old `unresolved` set was the
  // entire layout pre-event, hammering Liquipedia on every tick).
  //
  // The committed fixture is frozen all-open, so `picks_allowed` never flips for
  // it — without this, a Swiss stage that has begun would never become an ingest
  // candidate and the Valve oracle would never run (PHA-886/PHA-898). Mark a
  // section locked once its published lock instant has passed so the answer key
  // gets fetched the moment the stage starts. resolveOutcomesFromLayout still
  // reads the LIVE layout's own `picks_allowed`, so we never persist a result
  // for a stage Valve still reports as open — this only opens the candidate set.
  const now = Date.now();
  const lockedUnresolved = pickLockedUnresolvedSlots(layout, resolvedKey, (sectionId) =>
    isLockTimePassed(sectionId, now),
  );
  if (lockedUnresolved.length === 0) {
    return {
      eventId,
      source: "none",
      resolvedBefore,
      resolvedAfter: resolvedBefore,
      written: 0,
      rejected: 0,
      reason: resolvedBefore > 0 ? "fully-resolved" : "no-locked-unresolved",
    };
  }

  let raw: RawResolvedSlot[] = [];
  let source: "valve" | "liquipedia" | "none" = "none";
  let error: string | undefined;

  try {
    const valve = await tryValveOracle(eventId);
    if (valve && valve.length > 0) {
      raw = valve;
      source = "valve";
    } else {
      // Fallback: Liquipedia. The bracket page + slot mapper are event-specific;
      // pre-tournament this yields [] (no completed matches yet).
      raw = await fetchLiquipediaResults("IEM_Cologne_2026", () => null);
      source = "liquipedia";
    }
  } catch (e) {
    // Persisted throttle blocked the call: not an outage, just "try later".
    if (e instanceof LiquipediaThrottledError) {
      return {
        eventId,
        source: "none",
        resolvedBefore,
        resolvedAfter: resolvedBefore,
        written: 0,
        rejected: 0,
        reason: "throttled",
      };
    }
    // Source outage: keep what we have, report, do not throw into the caller.
    error = e instanceof Error ? e.message : String(e);
    return {
      eventId,
      source: "none",
      resolvedBefore,
      resolvedAfter: resolvedBefore,
      written: 0,
      rejected: 0,
      error,
      reason: "source-error",
    };
  }

  // Only persist slots not already resolved (terminal rows are never rewritten).
  const fresh = raw.filter((s) => !resolvedKey.has(`${s.sectionId}:${s.groupId}:${s.slotIndex}`));
  const { outcomes, rejected } = normalizeOutcomes(layout, fresh, source === "valve" ? "valve" : "liquipedia");

  await persistOutcomes(eventId, outcomes);

  // Freeze cumulative standings at this resolution for delta arrows + Stage
  // Reveal (PHA-858), but only when new outcomes actually landed. Graceful by
  // contract (rules #7/#8): a snapshot failure must never break the ingest
  // response — the leaderboard still scores live, arrows simply degrade.
  if (outcomes.length > 0) {
    try {
      await writeRankSnapshots(eventId);
    } catch (e) {
      console.error("[outcomes] rank-snapshot write failed (non-fatal):", e);
    }
  }

  return {
    eventId,
    source,
    resolvedBefore,
    resolvedAfter: resolvedBefore + outcomes.length,
    written: outcomes.length,
    rejected: rejected.length,
    error,
  };
}

// Dedicated refresh slot for the on-read driver (PHA-866), kept separate from the
// "liquipedia" parse throttle so this gates how often a refresh is *attempted*
// across the whole cluster — not just the API call deep inside ingestOutcomes.
const OUTCOMES_REFRESH_SOURCE = "outcomes-refresh";
const OUTCOMES_REFRESH_MIN_INTERVAL_MS = 30_000;

/**
 * Atomically claim the outcomes refresh slot — mirrors hltv.claimRefreshSlot
 * (PHA-863). Returns true iff the 30s floor has elapsed (or no row exists) AND
 * this caller won the race; under concurrency exactly one caller wins. A single
 * `updateMany` guarded by `lastCallAt < floor` is serialized by SQLite, so only
 * one flips the stamp; a count of 0 is disambiguated by a `create` that succeeds
 * only on the first-ever call. Best-effort: any DB error resolves to "allowed"
 * so a storage hiccup never permanently blocks the driver.
 */
async function claimOutcomesRefreshSlot(): Promise<boolean> {
  const now = new Date();
  const floor = new Date(now.getTime() - OUTCOMES_REFRESH_MIN_INTERVAL_MS);
  try {
    const res = await prisma.sourceState.updateMany({
      where: { source: OUTCOMES_REFRESH_SOURCE, lastCallAt: { lt: floor } },
      data: { lastCallAt: now },
    });
    if (res.count > 0) return true; // won the slot: floor had elapsed
    // INSERT OR IGNORE is atomic — succeeds only when no row exists, silently
    // skips otherwise (same fix as hltv.claimRefreshSlot). Avoids the P2002 that
    // `create` throws (and Prisma logs) when workers race at startup.
    const inserted = await prisma.$executeRaw`
      INSERT OR IGNORE INTO "SourceState" ("source", "lastCallAt")
      VALUES (${OUTCOMES_REFRESH_SOURCE}, ${now})
    `;
    return inserted > 0; // 1 = first-ever refresh; 0 = within floor or lost the race
  } catch {
    return true; // DB hiccup — don't let storage permanently block the driver
  }
}

/**
 * On-read self-refresh of outcomes (PHA-866). The live read surfaces call this so
 * the leaderboard / rank snapshots / Stage Reveal track official results as
 * matches finish, with NO external cron — the ingest route is owner/session-gated
 * (PHA-861), so a headless scheduler can't drive it anyway.
 *
 * Mirrors the news wire's read-path refresh (PHA-863, refreshWireOnRead): one
 * ATOMIC `claimOutcomesRefreshSlot` gates the whole refresh against the 30s floor
 * — lose the claim → no-op (warm window or a concurrent render already holds it),
 * win it → DEFER the slow ingest past the response via `after` so it never adds to
 * page latency. The slot is already stamped by the claim, so concurrent and
 * subsequent renders (across processes — the claim is DB-backed, not in-memory)
 * back off regardless of when the deferred ingest finishes. Never throws.
 *
 * ingestOutcomes is idempotent, event-gated (zero source calls pre-event / when
 * fully resolved — PHA-844), cache-hard, and bounded by the Liquipedia fetch
 * timeout; rank snapshots + Stage Reveal refresh transitively inside it.
 */
export async function refreshOutcomesOnRead(eventId: number): Promise<void> {
  if (!(await claimOutcomesRefreshSlot())) return; // within floor or lost the race — no-op
  runDeferred(() => ingestOutcomes(eventId)); // slow ingest — off the render path
}

/**
 * Run a best-effort background task without blocking (or coupling latency to) the
 * current render. Prefers Next's `after` so the work runs past the response and
 * isn't cut off; falls back to a floating promise when called outside a request
 * scope (e.g. tests). Errors are swallowed — the driver is best-effort.
 */
function runDeferred(task: () => Promise<unknown>): void {
  const run = () => {
    void task().catch((e) => console.error("[outcomes] deferred refresh failed (non-fatal):", e));
  };
  try {
    after(run);
  } catch {
    run();
  }
}

/** Upsert validated outcomes. Resolved rows are immutable — create-or-leave. */
async function persistOutcomes(eventId: number, outcomes: NormalizedOutcome[]): Promise<void> {
  if (outcomes.length === 0) return;
  await prisma.$transaction(
    outcomes.map((o) =>
      prisma.stageOutcome.upsert({
        where: {
          eventId_sectionId_groupId_slotIndex: {
            eventId,
            sectionId: o.sectionId,
            groupId: o.groupId,
            slotIndex: o.slotIndex,
          },
        },
        update: {}, // terminal — never rewrite a resolved result
        create: {
          eventId,
          sectionId: o.sectionId,
          groupId: o.groupId,
          slotIndex: o.slotIndex,
          winnerPickId: o.winnerPickId,
          source: o.source,
          resolvedAt: new Date(),
        },
      })
    )
  );
}
