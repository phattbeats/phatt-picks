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

export type OutcomeSource = "valve" | "liquipedia" | "hltv";

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

export interface LayoutOracleResult {
  /** Slots with a single, unambiguous correct team — ready to ingest. */
  resolved: RawResolvedSlot[];
  /** Locked slots whose `pickids` carry >1 team (bucket/set semantics) — left
   *  unresolved on purpose; the caller logs them for live confirmation. */
  ambiguous: SlotRef[];
}

/**
 * Resolve outcomes from a LIVE Valve layout's answer key (PHA-869).
 *
 * Valve's GetTournamentLayout returns each pick slot with a `pickids` array.
 * Pre-event / pre-resolution it is empty (see cologne-layout.json — every slot
 * is `pickids: []`); once a stage's result is official, Valve fills in the
 * correct-answer team(s) per slot. Reading the answer key from the very layout
 * players picked into makes this slot-correct by construction — the slot
 * ordering is Valve's own, identical to the ordering stored predictions use,
 * which is the only ordering the strict-index scorer (scoring.ts) can score
 * against. (An external source like Liquipedia can't know Valve's slot order,
 * which is why it can't resolve the set-valued Swiss buckets — see PHA-869.)
 *
 * Per-slot policy:
 *   - `pickids.length === 0` → unresolved, skipped.
 *   - `pickids.length === 1` → resolved, `winnerPickId = pickids[0]`.
 *   - `pickids.length  >  1` → ambiguous (e.g. a Swiss "advanced" bucket where
 *       several teams are interchangeable). We do NOT guess an index alignment —
 *       a wrong guess would mis-score — so the slot stays unresolved and is
 *       returned in `ambiguous` for the caller to log and confirm live.
 *
 * Only LOCKED groups (`picks_allowed === false`) are considered: results can't
 * exist while a stage is still open, and this guards against any seeding pass
 * that pre-populates pickids before lock. normalizeOutcomes still validates the
 * resolved slots against the committed layout, so a stale/odd live layout
 * degrades safely rather than corrupting scores.
 *
 * Pure: no fetch / prisma / fixture — the live layout is fetched by the caller.
 */
export function resolveOutcomesFromLayout(live: Layout): LayoutOracleResult {
  const resolved: RawResolvedSlot[] = [];
  const ambiguous: SlotRef[] = [];
  for (const section of live.sections) {
    for (const group of section.groups) {
      if (group.picks_allowed) continue; // stage still open — no results yet
      for (const p of group.picks) {
        const ids = p.pickids ?? [];
        if (ids.length === 0) continue; // unresolved
        const ref: SlotRef = {
          sectionId: section.sectionid,
          groupId: group.groupid,
          slotIndex: p.index,
        };
        if (ids.length > 1) {
          ambiguous.push(ref);
          continue;
        }
        resolved.push({ ...ref, winnerPickId: ids[0] });
      }
    }
  }
  return { resolved, ambiguous };
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

  // Global team roster (every team in the event). The HLTV bridge derives Swiss
  // clinches from the LIVE tournament field, which can legitimately be larger than
  // a section's committed per-group roster — e.g. Cologne Stage III: the pick'em
  // layout group carries 8 teams, but the live HLTV Swiss runs 16, so a real 0:3
  // (B8) / 3:0 (Spirit) clinch would otherwise be rejected "not eligible for group"
  // and never score (PHA-1109). For an HLTV-sourced winner we trust the live field
  // and validate against the global roster instead of the partial per-group one;
  // the slot/section/group existence checks still apply, and the winner is always a
  // real team the standings parser mapped to a layout pickid. Valve / Liquipedia
  // outcomes keep the stricter per-group check (they're validated against their own
  // structured data, where an out-of-group team IS a parse error).
  const globalTeams = new Set(layout.teams.map((t) => t.pickid).filter((id) => id !== 0));

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
    const eligible =
      group.teams.has(slot.winnerPickId) ||
      (source === "hltv" && globalTeams.has(slot.winnerPickId));
    if (!eligible) {
      rejected.push({ slot, reason: `winner ${slot.winnerPickId} not eligible for group` });
      continue;
    }
    outcomes.push({ ...slot, source });
  }

  return { outcomes, rejected };
}
