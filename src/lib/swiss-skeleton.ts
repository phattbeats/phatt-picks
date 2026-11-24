/**
 * The full 16-team Swiss skeleton shared by the live bracket board and the
 * simulator (PHA-5453): every round's column position, kind, cell count and
 * best-of. Columns left→right; within a column, advancing (3-win) box on top,
 * eliminated (3-loss) on the bottom, in-progress between. Pure leaf.
 */

export type SkeletonKind = "advancing" | "eliminated" | "contention";

export interface RoundSkel {
  kind: SkeletonKind;
  /** "match" rows (two teams + score) or settled "team" rows (advanced/eliminated). */
  type: "match" | "team";
  /** How many cells the round holds when full. */
  cells: number;
  /** Best-of for match rounds (0 for terminal team boxes). */
  bo: number;
}

export const SKELETON: Record<string, RoundSkel> = {
  "0:0": { kind: "contention", type: "match", cells: 8, bo: 1 },
  "1:0": { kind: "contention", type: "match", cells: 4, bo: 1 },
  "0:1": { kind: "contention", type: "match", cells: 4, bo: 1 },
  "3:0": { kind: "advancing", type: "team", cells: 2, bo: 0 },
  "2:0": { kind: "contention", type: "match", cells: 2, bo: 3 },
  "1:1": { kind: "contention", type: "match", cells: 4, bo: 1 },
  "0:2": { kind: "contention", type: "match", cells: 2, bo: 3 },
  "0:3": { kind: "eliminated", type: "team", cells: 2, bo: 0 },
  "3:1": { kind: "advancing", type: "team", cells: 3, bo: 0 },
  "2:1": { kind: "contention", type: "match", cells: 3, bo: 3 },
  "1:2": { kind: "contention", type: "match", cells: 3, bo: 3 },
  "1:3": { kind: "eliminated", type: "team", cells: 3, bo: 0 },
  "3:2": { kind: "advancing", type: "team", cells: 3, bo: 0 },
  "2:2": { kind: "contention", type: "match", cells: 3, bo: 3 },
  "2:3": { kind: "eliminated", type: "team", cells: 3, bo: 0 },
};

export const COLUMN_LAYOUT: readonly (readonly string[])[] = [
  ["0:0"],
  ["1:0", "0:1"],
  ["3:0", "2:0", "1:1", "0:2", "0:3"],
  ["3:1", "2:1", "1:2", "1:3"],
  ["3:2", "2:2", "2:3"],
];
