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

/** Per-pick comparison verdict used by the compare grid / steal reel. */
export type PickOutcomeState = "hit" | "miss" | "pending" | "empty";

export interface BucketWinners {
  /** pickIds of teams that actually landed in this bucket (set, order-free). */
  winners: Set<number>;
  /** true once every slot in the bucket has a resolved winner. */
  fullyResolved: boolean;
}

/**
 * Collapse a Swiss bucket's resolved slots into a winner SET (PHA-946).
 *
 * Within a Swiss bucket the slots are interchangeable — a team that lands in
 * the 3:1/3:2 bucket counts regardless of which of the six slots its winner row
 * occupies. Scoring already judges Swiss buckets as set intersections
 * (scoring.ts, PHA-918); the compare page must use the same grain or a correct
 * pick sitting in a different slot than its winner row reads as a miss.
 *
 * `0` is the API's "unresolved/placeholder" sentinel and is never a winner.
 */
export function resolveBucketWinners(
  slotIndexes: number[],
  groupOutcomes: { [slotIndex: number]: number },
): BucketWinners {
  const winners = new Set<number>();
  let resolved = 0;
  for (const idx of slotIndexes) {
    const w = groupOutcomes[idx];
    if (w !== undefined && w !== 0) {
      winners.add(w);
      resolved++;
    }
  }
  return { winners, fullyResolved: resolved === slotIndexes.length };
}

/**
 * Hit/miss/pending for a single pick judged against a bucket's winner set.
 *
 * A pick is a HIT if its team is among the bucket's resolved winners. It is a
 * MISS once the bucket is fully resolved (every slot decided) and the team isn't
 * a winner — OR early, when `impossible` is set: the team's partial record has
 * already ruled this bucket out (PHA-951; e.g. a 0:3 pick whose team won a game).
 * Until one of those holds, a not-yet-winning pick is still PENDING, never
 * prematurely struck through.
 */
export function bucketPickState(
  pick: number | undefined,
  { winners, fullyResolved }: BucketWinners,
  impossible = false,
): PickOutcomeState {
  if (!pick || pick === 0) return "empty";
  if (winners.has(pick)) return "hit";
  if (impossible) return "miss";
  return fullyResolved ? "miss" : "pending";
}
