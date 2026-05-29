/**
 * Layout-shape helpers (pure).
 *
 * Validation logic that takes a layout in and returns a verdict — no fixture
 * load, no bigint helper, no Next path-alias. Kept separate from layout.ts so
 * the verify harness can import it directly under `node` (the same reason
 * outcomes-core.ts is split out from outcomes.ts and reveal-core.ts from the
 * reveal/UI layer).
 */

import type { Layout } from "./layout";

/**
 * Validate a pick write against the layout (mirror of normalizeOutcomes' shape).
 * Returns null on success, or a short reason string on failure. The reason is
 * surfaced as the 400 body so a bad client request says exactly what's wrong.
 *
 * pickId 0 = "clear this slot" — only the (section, group, slot) need to
 * exist; the team check is skipped because zero is the explicit no-pick value.
 */
export function validatePickAgainstLayout(
  layout: Layout,
  sectionId: number,
  groupId: number,
  slotIndex: number,
  pickId: number,
): string | null {
  const section = layout.sections.find((s) => s.sectionid === sectionId);
  if (!section) return `unknown section ${sectionId}`;
  const group = section.groups.find((g) => g.groupid === groupId);
  if (!group) return `unknown group ${groupId} in section ${sectionId}`;
  if (!group.picks.some((p) => p.index === slotIndex)) return `unknown slot ${slotIndex}`;
  if (pickId === 0) return null;
  const eligible = new Set(group.teams.map((t) => t.pickid).filter((id) => id !== 0));
  if (!eligible.has(pickId)) return `team ${pickId} not eligible for group ${groupId}`;
  return null;
}
