/**
 * Outcome normalization (pure).
 *
 * Turns a raw resolved-results set (from the Valve oracle or the Liquipedia
 * MediaWiki API) into validated StageOutcome rows. Validation is done against
 * the layout so we never persist a result for a slot or team that doesn't
 * exist in the tournament structure — a typo in a Liquipedia bracket name
 * is dropped, not scored.
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under `node`.
 */

import type { Layout } from "./layout";

export type OutcomeSource = "valve" | "liquipedia";

/** Attribution required by Liquipedia's API terms (content is CC-BY-SA). */
export const LIQUIPEDIA_ATTRIBUTION =
  "Outcome data from Liquipedia, licensed CC-BY-SA 3.0 (https://liquipedia.net)";

/** A single resolved slot as reported by a source, pre-validation. */
export interface RawResolvedSlot {
  sectionId: number;
  groupId: number;
  slotIndex: number;
  winnerPickId: number;
}

/** A validated outcome row ready to persist. */
export interface NormalizedOutcome extends RawResolvedSlot {
  source: OutcomeSource;
}

export interface NormalizeResult {
  outcomes: NormalizedOutcome[];
  rejected: { slot: RawResolvedSlot; reason: string }[];
}

/**
 * Validate raw resolved slots against the layout.
 * - The (section, group, slot) must exist in the layout.
 * - The winning pickid must be a team eligible for that group (or 0 = no-result, dropped).
 */
export function normalizeOutcomes(
  layout: Layout,
  raw: RawResolvedSlot[],
  source: OutcomeSource
): NormalizeResult {
  const outcomes: NormalizedOutcome[] = [];
  const rejected: NormalizeResult["rejected"] = [];

  // Index layout: sectionId -> groupId -> { slotIndexes:Set, teamPickIds:Set }
  const index = new Map<number, Map<number, { slots: Set<number>; teams: Set<number> }>>();
  for (const section of layout.sections) {
    const byGroup = new Map<number, { slots: Set<number>; teams: Set<number> }>();
    for (const group of section.groups) {
      byGroup.set(group.groupid, {
        slots: new Set(group.picks.map((p) => p.index)),
        teams: new Set(group.teams.map((t) => t.pickid).filter((id) => id !== 0)),
      });
    }
    index.set(section.sectionid, byGroup);
  }

  for (const slot of raw) {
    const group = index.get(slot.sectionId)?.get(slot.groupId);
    if (!group) {
      rejected.push({ slot, reason: "unknown section/group" });
      continue;
    }
    if (!group.slots.has(slot.slotIndex)) {
      rejected.push({ slot, reason: "unknown slot index" });
      continue;
    }
    if (slot.winnerPickId === 0) {
      rejected.push({ slot, reason: "no winner (0/TBD) — not yet resolved" });
      continue;
    }
    if (!group.teams.has(slot.winnerPickId)) {
      rejected.push({ slot, reason: `winner ${slot.winnerPickId} not eligible for group` });
      continue;
    }
    outcomes.push({ ...slot, source });
  }

  return { outcomes, rejected };
}
