/**
 * Stage Wrapped — app-wide launch selector (#1051), DB-free core.
 *
 * Split out from `stage-wrapped-launch.ts` (which pulls prisma) so the pure
 * "which stage do we wrap?" decision can be proven offline by the verify
 * harness. Relative imports only — its whole graph stays install-free.
 */

import { stageWrappedHasContent } from "./stage-wrapped-content";
import type { Layout } from "./layout";
import type { OutcomeMap } from "./scoring";

/**
 * A stage is OVER only when EVERY slot of every group has a resolved winner (the
 * full answer key) — the same rule the picks page uses for `stageComplete`.
 * Before this, ONE resolved slot (a team clinching 3-0 on day 2) counted as
 * "resolved" and the recap notification/push fired days before the stage's last
 * game day. A section with no groups can never be complete.
 */
export function isStageFullyResolved(section: Layout["sections"][number], outcomeMap: OutcomeMap): boolean {
  const byGroup = outcomeMap[section.sectionid];
  const groups = section.groups ?? [];
  if (!byGroup || groups.length === 0) return false;
  return groups.every((g) => g.picks.every((slot) => byGroup[g.groupid]?.[slot.index] !== undefined));
}

/**
 * The most recent stage (by layout order) that is BOTH fully resolved (has an entry
 * in `outcomeMap`) and authored (has Stage Wrapped moments). This is the stage
 * whose recap auto-pops app-wide. Returns null when nothing qualifies yet, so
 * the launcher stays inert before the first authored stage resolves.
 *
 * "Latest" is layout order, not numeric section id — a future event could
 * number its stages arbitrarily; the order the sections appear is the truth.
 */
export function latestWrappedSectionId(layout: Layout, outcomeMap: OutcomeMap): number | null {
  for (let i = layout.sections.length - 1; i >= 0; i--) {
    const s = layout.sections[i];
    if (isStageFullyResolved(s, outcomeMap) && stageWrappedHasContent(layout.event, s.sectionid)) return s.sectionid;
  }
  return null;
}
