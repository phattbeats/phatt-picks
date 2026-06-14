/**
 * Live Swiss standings warm/refresh + outcome-resolve trigger (PHA-902, PHA-937).
 *
 * Populates the SwissStandingsCache for the live sections by crawling HLTV
 * SYNCHRONOUSLY (via warmStandings), so the bracket + table are guaranteed to
 * have data without depending on the on-read driver's deferred `after()` crawl —
 * which leaves a freshly-deployed (empty-cache) container showing nothing until a
 * crawl happens to land. Hitting this once after a deploy warms the cache; a
 * simple periodic poke keeps it fresh during a stage even if no one is browsing.
 *
 * Then it RESOLVES outcomes from that freshly-warmed cache (bridgeSwissOutcomes),
 * so the leaderboard scores the latest results too. Without this, outcome
 * resolution was purely read-driven (it only ran inside refreshOutcomesOnRead on
 * an authed page view), so a clean stage-to-stage transition depended on a logged-
 * in visitor loading a page at the right moment. Wiring the bridge in here makes
 * this single unauth URL a COMPLETE headless driver — an uptime monitor (or a
 * curl from anywhere) keeps standings fresh AND points climbing through a stage's
 * final matches, independent of traffic (PHA-937: "racking up the points, clean
 * transition"). The bridge self-gates on the published lock time, so it's a no-op
 * for any stage that hasn't started; off-window stages don't even crawl.
 *
 * Intentionally UNAUTHENTICATED, because it is safe by construction:
 *   - it takes NO user input — it only crawls the hard-coded HLTV event pages
 *     for the committed live sections (no SSRF surface),
 *   - it only writes our own public-standings cache and terminal, idempotent
 *     StageOutcome rows derived from it and validated against the committed layout
 *     (no data exposure, nothing destructive, never rewrites a resolved result),
 *   - it is rate-limited: off-window sections no-op, and a warm cache is bounded
 *     by the same ~1h SourceState claim the on-read driver uses, so repeated
 *     calls can't hammer the source (a COLD cache always crawls so a stamped-but-
 *     empty slot self-heals).
 * The route matcher excludes /api from the splash gate, so this is reachable
 * without a session — which is the point (deploy-time warm + headless poke).
 */

import { NextResponse } from "next/server";
import { warmStandings, standingsSectionIds } from "@/lib/swiss-results";
import { bridgeSwissOutcomes } from "@/lib/outcomes";
import { currentEventId } from "@/lib/events-core";
import { getCommittedLayout } from "@/lib/layout";
import { prisma } from "@/lib/db";
import { bucketSwissSlots, isSwissSection } from "@/lib/swiss-bucket-core";

export const dynamic = "force-dynamic";

/**
 * Read-only dump of the resolved Swiss answer key + each slot's bucket and team
 * name (PHA-1109 diagnostic). The resolved outcomes are already public on the
 * leaderboard / reveal, so this exposes nothing new — it just makes "which team
 * is the bridge crediting in which bucket" inspectable from a single headless
 * poke, which is exactly the question a frozen / mis-resolved clinch raises.
 */
async function dumpAnswerKey(eventId: number) {
  const layout = getCommittedLayout();
  const nameByPick = new Map(layout.teams.map((t) => [t.pickid, t.name]));
  const rows = await prisma.stageOutcome.findMany({
    where: { eventId },
    select: { sectionId: true, groupId: true, slotIndex: true, winnerPickId: true },
  });
  const dump: Record<number, Array<{ slot: number; bucket: string; pickId: number; team: string }>> = {};
  for (const section of layout.sections) {
    if (!isSwissSection(section.sectionid)) continue;
    const group = section.groups[0];
    const bucketBySlot = new Map<number, string>();
    for (const b of bucketSwissSlots(group?.picks.length ?? 10)) {
      for (const s of b.slotIndexes) bucketBySlot.set(s, b.label);
    }
    const secRows = rows
      .filter((r) => r.sectionId === section.sectionid)
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((r) => ({
        slot: r.slotIndex,
        bucket: bucketBySlot.get(r.slotIndex) ?? "?",
        pickId: r.winnerPickId,
        team: nameByPick.get(r.winnerPickId) ?? `unknown#${r.winnerPickId}`,
      }));
    if (secRows.length) dump[section.sectionid] = secRows;
  }
  return dump;
}

async function warmAll() {
  const EVENT_ID = currentEventId(); // per-request active event (PHA-1046)
  const results = [];
  for (const section of standingsSectionIds(EVENT_ID)) {
    results.push(await warmStandings(EVENT_ID, section));
  }
  // Resolve outcomes from the now-warm cache so a headless poke also keeps the
  // leaderboard scoring (not just the standings table). Graceful by contract:
  // a bridge failure must never break the warm response — standings still warmed.
  let resolved = 0;
  try {
    resolved = await bridgeSwissOutcomes(EVENT_ID);
  } catch (e) {
    console.error("[standings/refresh] outcome bridge failed (non-fatal):", e);
  }
  let answerKey: Awaited<ReturnType<typeof dumpAnswerKey>> = {};
  try {
    answerKey = await dumpAnswerKey(EVENT_ID);
  } catch (e) {
    console.error("[standings/refresh] answer-key dump failed (non-fatal):", e);
  }
  return NextResponse.json({ ok: true, eventId: EVENT_ID, results, resolved, answerKey });
}

// GET so it's trivial to warm from a browser / curl / uptime poke; POST aliased
// for callers that prefer it. Both run the same safe, gated warm.
export const GET = warmAll;
export const POST = warmAll;
