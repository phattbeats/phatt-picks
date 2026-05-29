/**
 * Stage-pickability gate (pure).
 *
 * A stage's pick window opens only once the prior stage's outcomes are fully
 * resolved. Pre-event everything is "future" except the first section, which
 * is pickable from the start. The committed cologne layout ships every group
 * `picks_allowed:true`, and stages 3 / playoffs carry `pickid:0` (TBD) team
 * slots — without this gate the UI would let players "pick" placeholder
 * teams that don't yet exist (Brandon's 2026-05-28 live-deploy report).
 *
 * The rule:
 *   - Section 0 (in layout order) is pickable iff its groups remain open
 *     (`picks_allowed === true`).
 *   - Every other section is pickable iff (a) its groups remain open AND
 *     (b) every slot of the IMMEDIATELY PREVIOUS section already has a
 *     resolved StageOutcome row.
 *
 * Why "immediately previous" and not "every previous": stages are sequential,
 * and the chain naturally enforces transitive resolution (you can't reach
 * stage 3 without stage 2 being fully resolved, because stage 2 only unlocks
 * after stage 1). For the playoff sections (108 QF -> 109 SF -> 110 Final)
 * the same chain handles bracket reveal: SFs unlock once all four QFs resolve.
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under `node`.
 */

import type { Layout } from "./layout";

export type StagePickability =
  /** Open for picks — render the picker. */
  | { pickable: true; reason: "open" }
  /** Valve closed the window — render the same Locked card; picks are revealed elsewhere. */
  | { pickable: false; reason: "locked-by-valve" }
  /** Upstream stage hasn't resolved yet — render Locked card pointing at it. */
  | {
      pickable: false;
      reason: "previous-stage-unresolved";
      previousSectionId: number;
      previousSectionName: string;
    }
  /** Unknown section id — defensive deny (e.g. typo in querystring). */
  | { pickable: false; reason: "unknown-section" };

/** Build the `${sectionId}:${groupId}:${slotIndex}` key set from raw StageOutcome rows. */
export function buildResolvedKeys(
  rows: ReadonlyArray<{ sectionId: number; groupId: number; slotIndex: number }>,
): Set<string> {
  return new Set(rows.map((r) => `${r.sectionId}:${r.groupId}:${r.slotIndex}`));
}

/** Does the previous section have a resolved StageOutcome for every slot it defines? */
function isSectionFullyResolved(
  section: Layout["sections"][number],
  resolvedKeys: ReadonlySet<string>,
): boolean {
  for (const group of section.groups) {
    for (const p of group.picks) {
      if (!resolvedKeys.has(`${section.sectionid}:${group.groupid}:${p.index}`)) {
        return false;
      }
    }
  }
  return true;
}

export function isStagePickable(
  layout: Layout,
  resolvedKeys: ReadonlySet<string>,
  sectionId: number,
): StagePickability {
  const idx = layout.sections.findIndex((s) => s.sectionid === sectionId);
  if (idx < 0) return { pickable: false, reason: "unknown-section" };

  const section = layout.sections[idx];

  // Valve has closed the pick window on every group in this stage -> locked.
  // (The committed fixture is all-open, so this branch only fires once the
  // live layout refresh flips the flag.)
  if (section.groups.length > 0 && section.groups.every((g) => g.picks_allowed === false)) {
    return { pickable: false, reason: "locked-by-valve" };
  }

  // First stage is always open until Valve locks it.
  if (idx === 0) return { pickable: true, reason: "open" };

  const prev = layout.sections[idx - 1];
  if (!isSectionFullyResolved(prev, resolvedKeys)) {
    return {
      pickable: false,
      reason: "previous-stage-unresolved",
      previousSectionId: prev.sectionid,
      previousSectionName: prev.name.split(" | ")[0],
    };
  }

  return { pickable: true, reason: "open" };
}
