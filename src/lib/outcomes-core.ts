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

/** Identity of a slot (no winner) — used to enumerate ingest candidates. */
export interface SlotRef {
  sectionId: number;
  groupId: number;
  slotIndex: number;
}

/**
 * Slots eligible for outcome ingestion: those whose pick window has CLOSED
 * (`picks_allowed === false`) and which do not yet have a resolved row.
 *
 * Why locked-only: results can only exist after picks lock. Filtering on
 * "unresolved" alone (the old behavior) treats every open stage as a candidate
 * pre-event, which makes the ingest tick call the source on every poll — the
 * Liquipedia bug that triggered PHA-844. Locked-and-unresolved yields the empty
 * set against the all-open layout, so the caller can short-circuit before any
 * source request.
 *
 * Pure: takes the layout and an already-fetched set of resolved-slot keys
 * (`"sectionId:groupId:slotIndex"`), returns the filtered list. The caller is
 * responsible for DB I/O.
 */
export function pickLockedUnresolvedSlots(
  layout: Layout,
  resolvedKey: ReadonlySet<string>
): SlotRef[] {
  const out: SlotRef[] = [];
  for (const section of layout.sections) {
    for (const group of section.groups) {
      if (group.picks_allowed) continue; // stage still open — no results possible
      for (const p of group.picks) {
        const key = `${section.sectionid}:${group.groupid}:${p.index}`;
        if (resolvedKey.has(key)) continue; // terminal — already in StageOutcome
        out.push({
          sectionId: section.sectionid,
          groupId: group.groupid,
          slotIndex: p.index,
        });
      }
    }
  }
  return out;
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
