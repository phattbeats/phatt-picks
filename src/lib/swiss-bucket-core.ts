/**
 * Swiss-stage bucket grouping (pure, UI-only convention).
 *
 * Valve's Pick'Em API returns each Swiss stage as one flat group with N slots,
 * all worth the same `points_per_pick`. Their UI visually buckets those slots
 * by predicted outcome (3:0 advance / 3:1 / 3:2 advance / 0:3 eliminated). The
 * bucket labels and slot-to-bucket map aren't in the layout JSON — they're
 * convention. PHA-853 matches the UI to that convention.
 *
 * Scoring is unaffected — every Swiss slot is still worth the stage's
 * `points_per_pick` regardless of which bucket the UI renders it in.
 *
 * No fixture/bigint imports so verify-* harnesses can run this under node.
 */

export interface SwissBucket {
  label: string;
  slotIndexes: number[];
}

/**
 * Bucket a Swiss stage's flat pick slots by predicted outcome. The 10-slot
 * layout below matches the Cologne 2026 Stage I screenshot Brandon attached on
 * PHA-853 (2 / 6 / 2 split: 3:0 advance, 3:1 / 3:2 advance, 0:3 eliminated).
 *
 * Returning the same single-card fallback for any non-10 count means a future
 * format change (e.g. an 8-team final stage) renders as one flat card instead
 * of misbucketing — explicit "we don't know how to split this" beats lying.
 */
export function bucketSwissSlots(slotCount: number): SwissBucket[] {
  if (slotCount === 10) {
    return [
      { label: "3:0 ADVANCED", slotIndexes: [0, 1] },
      { label: "3:1 / 3:2 ADVANCED", slotIndexes: [2, 3, 4, 5, 6, 7] },
      { label: "0:3 ELIMINATED", slotIndexes: [8, 9] },
    ];
  }
  return [
    {
      label: "PICKS",
      slotIndexes: Array.from({ length: slotCount }, (_, i) => i),
    },
  ];
}

const SWISS_SECTION_IDS = new Set([105, 106, 107]);

export function isSwissSection(sectionId: number): boolean {
  return SWISS_SECTION_IDS.has(sectionId);
}
