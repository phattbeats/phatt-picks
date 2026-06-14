/**
 * Stage-pickability gate (pure).
 *
 * Valve opens the Pick'Em windows for every Swiss stage at once — you call your
 * 3-0 / 0-3 / advancing picks for Stage I, II and III up front, before a single
 * map is played (Brandon confirmed live on 2026-06-02: "Stage 1, 2, and 3 are
 * all active … its open"). So pickability is NOT a sequential chain that waits
 * for the prior stage to resolve. It is driven by two live facts only:
 *
 *   1. Valve's `picks_allowed` flag — while it's true the window is open; once
 *      every group in a section flips it off, that stage is locked.
 *   2. Whether the stage is SEEDED — i.e. it has real teams to choose from.
 *      The committed cologne layout carries `pickid:0` (TBD) team slots for the
 *      playoff bracket (QF/SF/GF) and any not-yet-seeded Swiss slot. A stage
 *      whose every team slot is still TBD has nothing real to pick, so it stays
 *      locked until Valve seeds it — this is what stops players "picking"
 *      placeholder teams that don't exist yet (Brandon's 2026-05-28 report).
 *
 * The rule:
 *   - A section is pickable iff its groups remain open (`picks_allowed === true`
 *     on at least one group) AND at least one of its team slots is a real team
 *     (`pickid !== 0`).
 *   - The Swiss stages (I/II/III) are seeded, so they open together the moment
 *     Valve allows picks. The playoff sections stay locked until the bracket is
 *     seeded, then open on their own.
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under `node`.
 */

import type { Layout } from "./layout";

export type StagePickability =
  /** Open for picks — render the picker. */
  | { pickable: true; reason: "open" }
  /** The stage's published lock time has passed — it has begun, picks closed. */
  | { pickable: false; reason: "locked-time-passed" }
  /** Valve closed the window — render the Locked card; picks are revealed elsewhere. */
  | { pickable: false; reason: "locked-by-valve" }
  /** Teams aren't seeded yet (every slot TBD) — render Locked card. */
  | { pickable: false; reason: "teams-not-set" }
  /** Unknown section id — defensive deny (e.g. typo in querystring). */
  | { pickable: false; reason: "unknown-section" };

/** Build the `${sectionId}:${groupId}:${slotIndex}` key set from raw StageOutcome rows. */
export function buildResolvedKeys(
  rows: ReadonlyArray<{ sectionId: number; groupId: number; slotIndex: number }>,
): Set<string> {
  return new Set(rows.map((r) => `${r.sectionId}:${r.groupId}:${r.slotIndex}`));
}

/** Does this section have at least one real (non-TBD) team to pick from? */
function isSectionSeeded(section: Layout["sections"][number]): boolean {
  for (const group of section.groups) {
    for (const team of group.teams) {
      if (team.pickid !== 0) return true;
    }
  }
  return false;
}

export interface StageGateOpts {
  /**
   * The section's published lock instant has passed (PHA-898). The caller
   * computes this from the lock schedule vs. the current time
   * (`isLockTimePassed`) and passes it in, keeping this module pure. When true
   * the stage is locked regardless of the (stale, all-open) committed
   * `picks_allowed` flag — "Stage 1 has begun" is the truth the fixture can't
   * carry until a live Valve fetch lands.
   */
  lockedByTime?: boolean;
}

/**
 * Which section is the event's CURRENT stage — the one a player should land on
 * "now" (PHA-1007 dashboard hero, PHA-1050 picks-nav default)?
 *
 * Priority:
 *   1. The first stage whose pick window is OPEN — real urgency, real countdown.
 *   2. Otherwise the LATEST stage that has actually STARTED (its lock time
 *      passed, or Valve closed it) — the stage in progress right now. Mid-event
 *      this should read "check your picks, watch the matches", not manufacture
 *      urgency for a future stage.
 *   3. Defensive fallback: the last section.
 *
 * Before this rule the dashboard hero's fallback was always the LAST section, so
 * the moment Stage III locked the hero jumped to the un-seeded Grand Final — a
 * stage whose window doesn't open for another week. The picks page shared the
 * opposite bug from the other end: it always defaulted to the FIRST section
 * (Stage I), so clicking "Picks" mid-event dropped you on a long-locked stage
 * instead of the live one. Both now resolve the same "current stage" here.
 */
export function selectCurrentStageIndex(
  statuses: ReadonlyArray<StagePickability>,
): number {
  const firstOpen = statuses.findIndex((s) => s.pickable);
  if (firstOpen >= 0) return firstOpen;
  for (let i = statuses.length - 1; i >= 0; i--) {
    const reason = statuses[i].reason;
    if (reason === "locked-time-passed" || reason === "locked-by-valve") {
      return i;
    }
  }
  return statuses.length - 1;
}

export function isStagePickable(
  layout: Layout,
  sectionId: number,
  opts: StageGateOpts = {},
): StagePickability {
  const section = layout.sections.find((s) => s.sectionid === sectionId);
  if (!section) return { pickable: false, reason: "unknown-section" };

  // The stage's published lock time has passed — its first match has begun, so
  // the Pick'Em window is closed even though the frozen fixture still says
  // `picks_allowed:true`. Takes precedence over the live flag below: a stage
  // that has demonstrably started is never "open" again.
  if (opts.lockedByTime) {
    return { pickable: false, reason: "locked-time-passed" };
  }

  // Valve has closed the pick window on every group in this stage -> locked.
  // (The committed fixture is all-open, so this branch only fires once the
  // live layout refresh flips the flag.)
  if (section.groups.length > 0 && section.groups.every((g) => g.picks_allowed === false)) {
    return { pickable: false, reason: "locked-by-valve" };
  }

  // No real teams yet (every slot TBD) — e.g. the playoff bracket pre-seeding.
  // Stay locked so the picker never offers placeholder teams.
  if (!isSectionSeeded(section)) {
    return { pickable: false, reason: "teams-not-set" };
  }

  return { pickable: true, reason: "open" };
}
