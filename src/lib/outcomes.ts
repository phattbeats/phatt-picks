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

import { prisma } from "./db";
import { getCommittedLayout, type Layout } from "./layout";
import {
  normalizeOutcomes,
  type NormalizedOutcome,
  type RawResolvedSlot,
} from "./outcomes-core";
import { fetchLiquipediaResults } from "./liquipedia";

export interface IngestSummary {
  eventId: number;
  source: "valve" | "liquipedia" | "none";
  resolvedBefore: number;
  resolvedAfter: number;
  written: number;
  rejected: number;
  error?: string;
}

/** Every (sectionId, groupId, slotIndex) the layout defines a result for. */
function allSlots(layout: Layout): RawResolvedSlot[] {
  const slots: RawResolvedSlot[] = [];
  for (const s of layout.sections) {
    for (const g of s.groups) {
      for (const p of g.picks) {
        slots.push({ sectionId: s.sectionid, groupId: g.groupid, slotIndex: p.index, winnerPickId: 0 });
      }
    }
  }
  return slots;
}

/**
 * Probe the Valve oracle for resolved results. Returns null when Valve does not
 * expose finished-stage results for this event (the documented default — the
 * pick'em layout API surfaces predictions, not an authoritative results feed).
 * Wired as a hook so a future Valve results endpoint can slot in here without
 * touching the ingestion flow.
 */
async function tryValveOracle(eventId: number): Promise<RawResolvedSlot[] | null> {
  void eventId; // reserved: a future Valve results endpoint keys off the event
  return null;
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

  const unresolved = allSlots(layout).filter(
    (s) => !resolvedKey.has(`${s.sectionId}:${s.groupId}:${s.slotIndex}`)
  );

  // Cache hard: nothing left to resolve → no source call at all.
  if (unresolved.length === 0) {
    return { eventId, source: "none", resolvedBefore, resolvedAfter: resolvedBefore, written: 0, rejected: 0 };
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
    // Source outage: keep what we have, report, do not throw into the caller.
    error = e instanceof Error ? e.message : String(e);
    return { eventId, source: "none", resolvedBefore, resolvedAfter: resolvedBefore, written: 0, rejected: 0, error };
  }

  // Only persist slots not already resolved (terminal rows are never rewritten).
  const fresh = raw.filter((s) => !resolvedKey.has(`${s.sectionId}:${s.groupId}:${s.slotIndex}`));
  const { outcomes, rejected } = normalizeOutcomes(layout, fresh, source === "valve" ? "valve" : "liquipedia");

  await persistOutcomes(eventId, outcomes);

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
