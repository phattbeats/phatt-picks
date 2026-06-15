/**
 * Stage Wrapped — app-wide launch selector (PHA-1051), DB-free core.
 *
 * Split out from `stage-wrapped-launch.ts` (which pulls prisma) so the pure
 * "which stage do we wrap?" decision can be proven offline by the verify
 * harness. Relative imports only — its whole graph stays install-free.
 */

import { stageWrappedHasContent } from "./stage-wrapped-content";
import type { Layout } from "./layout";
import type { OutcomeMap } from "./scoring";

/**
 * The most recent stage (by layout order) that is BOTH resolved (has an entry
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
    if (outcomeMap[s.sectionid] && stageWrappedHasContent(s.sectionid)) return s.sectionid;
  }
  return null;
}
