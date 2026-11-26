/**
 * stage-end-core - "the stage is over, you can lift the spoiler-free veil"
 * (PHA-5498), pure.
 *
 * The stage-end push has to fire at ONE moment: when every pick slot of a
 * stage has a resolved outcome. Not when the clock says so, and not when the
 * first slot resolves (that is the bug the recap push shipped with — see
 * `isStageFullyResolved`).
 *
 * The rule itself lives in `stage-wrapped-launch-core` (shared, DB-free), so
 * the picks page, the recap push and this push all agree on what "the stage
 * is over" means. This module adds the one thing the push needs on top: the
 * MOST RECENT completed Swiss stage, because spoiler-free only exists on the
 * Swiss picks page — a completed playoff round has no veil to lift, so it
 * does not get a stage-end notice.
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under node.
 */

import { isStageFullyResolved } from "./stage-wrapped-launch-core";
import { isSwissSection } from "./swiss-bucket-core";
import type { Layout } from "./layout";
import type { OutcomeMap } from "./scoring";

/**
 * The most recent (by layout order) Swiss stage whose every slot has a
 * resolved winner, or null when no stage has finished.
 *
 * Layout order, not numeric id: the newest stage is the last one in the
 * layout, whatever its id. Playoff sections are skipped — they are not Swiss
 * stages and carry no spoiler-free toggle.
 */
export function latestCompletedSwissSectionId(
  layout: Layout,
  outcomeMap: OutcomeMap,
): number | null {
  for (let i = layout.sections.length - 1; i >= 0; i--) {
    const s = layout.sections[i];
    if (!isSwissSection(s.sectionid)) continue;
    if (isStageFullyResolved(s, outcomeMap)) return s.sectionid;
  }
  return null;
}
