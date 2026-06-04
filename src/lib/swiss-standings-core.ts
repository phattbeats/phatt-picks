/**
 * Live Swiss lineup / standings (pure, PHA-898).
 *
 * Once Stage I begins, players want what every other site shows: the Swiss
 * lineup with each team's standing, so they can track how the teams THEY picked
 * are doing. We build that from the only live result source we already trust —
 * Valve's answer key (the resolved StageOutcome rows, refreshed on read by
 * PHA-866). As teams clinch, Valve fills each pick slot's correct team; mapping
 * those resolved slots back through the Swiss bucket convention (swiss-bucket-
 * core) tells us which teams have gone 3-0, which advanced, and which crashed
 * 0-3. Teams not yet in any resolved slot are still in contention.
 *
 * TRUTHFUL BY CONSTRUCTION: we report clinch STATUS, never a fabricated win-loss
 * record. Valve's answer key carries the bucket a team landed in once it clinches
 * — it does not expose running map scores, and we don't invent them. A team with
 * no resolved slot is shown "still in it", not a guessed record.
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under `node`.
 */

import type { Section } from "./layout";
import type { SwissBucket } from "./swiss-bucket-core";

/**
 * Slot-bucketing function — injected (not imported) so this stays a leaf module
 * with type-only deps and loads directly under the verify harness, matching the
 * other pure cores. Callers pass `bucketSwissSlots` from swiss-bucket-core, the
 * single source of the 3:0 / advance / 0:3 convention.
 */
export type BucketsForSlotCount = (slotCount: number) => SwissBucket[];

export type SwissTeamStatus =
  /** Clinched a 3:0 run (top advance bucket). */
  | "advanced-3-0"
  /** Advanced (3:1 / 3:2 bucket). */
  | "advanced"
  /** Eliminated (0:3 bucket). */
  | "eliminated"
  /** No result yet — still in contention. */
  | "live";

export interface SwissTeamRow {
  pickid: number;
  status: SwissTeamStatus;
  /** Did the viewer pick this team anywhere in the stage? */
  userPicked: boolean;
}

export interface SwissUserPick {
  pickid: number;
  groupId: number;
  slotIndex: number;
  /** Human bucket the viewer slotted this team into (e.g. "3:0 ADVANCED"). */
  bucketLabel: string;
  /** hit = team landed in the bucket the viewer predicted; miss = it clinched a
   *  different bucket; pending = that slot has no result yet. */
  result: "hit" | "miss" | "pending";
}

export interface SwissStandings {
  /** Every competing team in the stage, with its current clinch status. */
  teams: SwissTeamRow[];
  /** The viewer's picks for this stage (empty when signed out / no picks). */
  userPicks: SwissUserPick[];
  /** Teams that have clinched a result so far (advanced/eliminated). */
  resolvedTeamCount: number;
  totalTeams: number;
  userHits: number;
  userPending: number;
  userTotal: number;
}

/** Map a Swiss bucket label to a team-status code. */
function statusForBucketLabel(label: string): Exclude<SwissTeamStatus, "live"> {
  if (label.includes("0:3")) return "eliminated";
  if (label === "3:0 ADVANCED") return "advanced-3-0";
  return "advanced"; // 3:1 / 3:2 advance, or the single-bucket fallback
}

/** Per-section answer-key + viewer-pick maps: groupId -> slotIndex -> pickId. */
export type SlotPickMap = Readonly<Record<number, Readonly<Record<number, number>>>>;

/**
 * Build the live Swiss standings for a section from the resolved answer key and
 * (optionally) the viewer's picks. Both maps are `groupId -> slotIndex ->
 * pickId`; pass `{}` for a viewer with no picks.
 */
export function buildSwissStandings(
  section: Section,
  outcomesForSection: SlotPickMap,
  bucketsFor: BucketsForSlotCount,
  userPicksForSection: SlotPickMap = {},
): SwissStandings {
  // 1. Distinct competing teams, in layout order.
  const teamOrder: number[] = [];
  const seen = new Set<number>();
  for (const group of section.groups) {
    for (const t of group.teams) {
      if (t.pickid !== 0 && !seen.has(t.pickid)) {
        seen.add(t.pickid);
        teamOrder.push(t.pickid);
      }
    }
  }

  // 2. slotIndex -> bucket label, per group.
  const bucketLabelByGroupSlot = new Map<string, string>();
  for (const group of section.groups) {
    const buckets = bucketsFor(group.picks.length);
    for (const b of buckets) {
      for (const slot of b.slotIndexes) {
        bucketLabelByGroupSlot.set(`${group.groupid}:${slot}`, b.label);
      }
    }
  }

  // 3. Resolve each clinched team's status from the bucket of the slot it won.
  const statusByTeam = new Map<number, Exclude<SwissTeamStatus, "live">>();
  for (const group of section.groups) {
    const gOut = outcomesForSection[group.groupid] ?? {};
    for (const [slotStr, winner] of Object.entries(gOut)) {
      if (!winner || winner === 0) continue;
      const label = bucketLabelByGroupSlot.get(`${group.groupid}:${Number(slotStr)}`);
      if (!label) continue;
      // A team clinches exactly one outcome; first wins if a feed ever doubles up.
      if (!statusByTeam.has(winner)) statusByTeam.set(winner, statusForBucketLabel(label));
    }
  }

  // 4. Which teams the viewer picked (anywhere in the stage).
  const userPickedTeams = new Set<number>();
  const userPicks: SwissUserPick[] = [];
  for (const group of section.groups) {
    const gPicks = userPicksForSection[group.groupid] ?? {};
    for (const [slotStr, pickId] of Object.entries(gPicks)) {
      if (!pickId || pickId === 0) continue;
      const slotIndex = Number(slotStr);
      userPickedTeams.add(pickId);
      const bucketLabel = bucketLabelByGroupSlot.get(`${group.groupid}:${slotIndex}`) ?? "PICK";
      // Bucket-aware (PHA-918): a Swiss bucket's slots are interchangeable, so a
      // pick is a HIT when the team clinched the SAME bucket the viewer slotted it
      // into — compared by clinched status, not slot-for-slot (the answer key
      // resolves teams into bucket slots in standings order, not the viewer's). A
      // team that clinched a different bucket is a miss; one not yet resolved is
      // pending.
      const expected = statusForBucketLabel(bucketLabel);
      const actual = statusByTeam.get(pickId);
      const result: SwissUserPick["result"] =
        actual === undefined ? "pending" : actual === expected ? "hit" : "miss";
      userPicks.push({ pickid: pickId, groupId: group.groupid, slotIndex, bucketLabel, result });
    }
  }

  const teams: SwissTeamRow[] = teamOrder.map((pickid) => ({
    pickid,
    status: statusByTeam.get(pickid) ?? "live",
    userPicked: userPickedTeams.has(pickid),
  }));

  return {
    teams,
    userPicks,
    resolvedTeamCount: statusByTeam.size,
    totalTeams: teamOrder.length,
    userHits: userPicks.filter((p) => p.result === "hit").length,
    userPending: userPicks.filter((p) => p.result === "pending").length,
    userTotal: userPicks.length,
  };
}

/** UI grouping order + display labels for the standings columns. */
export const SWISS_STATUS_GROUPS: ReadonlyArray<{ status: SwissTeamStatus; label: string }> = [
  { status: "advanced-3-0", label: "3:0 — ADVANCED" },
  { status: "advanced", label: "ADVANCED" },
  { status: "live", label: "STILL IN CONTENTION" },
  { status: "eliminated", label: "0:3 — ELIMINATED" },
];
