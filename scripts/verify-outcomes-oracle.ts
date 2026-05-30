/**
 * verify-outcomes-oracle — offline proof of the Valve layout outcome oracle (PHA-869).
 *
 * The live resolver reads results from Valve's GetTournamentLayout: once a stage
 * resolves, each pick slot's `pickids` holds the correct-answer team(s). This is
 * a pure-module check (no DB, no network): it drives resolveOutcomesFromLayout
 * against synthetic layouts to prove the per-slot policy —
 *   - empty pickids (pre-event)      → nothing resolved (structural no-op),
 *   - locked slot, single pickid     → resolved with that winner,
 *   - locked slot, multiple pickids  → ambiguous, NOT resolved (left for live),
 *   - OPEN group (picks_allowed)     → never resolved, even if pickids present.
 * The resolved `pickids` shape itself is confirmed live at the stage-1 opener;
 * this proves the mapping logic is correct and degrades safely until then.
 *
 * Run: node scripts/verify-outcomes-oracle.ts
 */

import { resolveOutcomesFromLayout } from "../src/lib/outcomes-core.ts";
import type { Layout } from "../src/lib/layout.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name);
  }
}

/**
 * Synthetic layout mirroring Cologne's shape: a Swiss-style stage (one locked
 * group, multiple slots) and a playoff-style match group, plus one still-open
 * group. `pickids` per slot is the knob each test sets.
 */
function makeLayout(opts: {
  swissPickids: number[][]; // pickids per slot in the locked Swiss group (10 slots)
  playoffPickids: number[]; // pickids for the single playoff match slot
  openPickids: number[]; // pickids for the OPEN group's slot (should be ignored)
}): Layout {
  return {
    event: 99,
    name: "Test Event",
    sections: [
      {
        sectionid: 105,
        name: "Stage I",
        groups: [
          {
            groupid: 271,
            name: "Swiss",
            points_per_pick: 1,
            picks_allowed: false, // locked → eligible
            teams: [{ pickid: 12 }, { pickid: 89 }, { pickid: 95 }, { pickid: 106 }],
            picks: opts.swissPickids.map((ids, index) => ({ index, pickids: ids })),
          },
        ],
      },
      {
        sectionid: 108,
        name: "Quarterfinals",
        groups: [
          {
            groupid: 274,
            name: "QF Match 1",
            points_per_pick: 12,
            picks_allowed: false, // locked → eligible
            teams: [{ pickid: 12 }, { pickid: 89 }],
            picks: [{ index: 0, pickids: opts.playoffPickids }],
          },
        ],
      },
      {
        sectionid: 106,
        name: "Stage II (still open)",
        groups: [
          {
            groupid: 272,
            name: "Open Swiss",
            points_per_pick: 2,
            picks_allowed: true, // OPEN → must be ignored
            teams: [{ pickid: 12 }, { pickid: 89 }],
            picks: [{ index: 0, pickids: opts.openPickids }],
          },
        ],
      },
    ],
  };
}

console.log("\noutcomes-oracle — pre-event layout (all pickids empty) is a no-op");

const preEvent = makeLayout({
  swissPickids: Array.from({ length: 10 }, () => []),
  playoffPickids: [],
  openPickids: [],
});
const r0 = resolveOutcomesFromLayout(preEvent);
check("pre-event resolves nothing", r0.resolved.length === 0);
check("pre-event flags nothing ambiguous", r0.ambiguous.length === 0);

console.log("\noutcomes-oracle — resolved stage produces slot-correct winners");

const resolvedLayout = makeLayout({
  // Two Swiss slots resolved to single teams; the rest still empty.
  swissPickids: [[12], [89], [], [], [], [], [], [], [], []],
  playoffPickids: [95], // QF match 1 won by team 95
  openPickids: [],
});
const r1 = resolveOutcomesFromLayout(resolvedLayout);
check("resolves exactly the populated single-pickid slots", r1.resolved.length === 3);
check(
  "Swiss slot 0 → winner 12 at (105,271,0)",
  r1.resolved.some(
    (s) => s.sectionId === 105 && s.groupId === 271 && s.slotIndex === 0 && s.winnerPickId === 12,
  ),
);
check(
  "Swiss slot 1 → winner 89 at (105,271,1)",
  r1.resolved.some(
    (s) => s.sectionId === 105 && s.groupId === 271 && s.slotIndex === 1 && s.winnerPickId === 89,
  ),
);
check(
  "playoff match → winner 95 at (108,274,0)",
  r1.resolved.some(
    (s) => s.sectionId === 108 && s.groupId === 274 && s.slotIndex === 0 && s.winnerPickId === 95,
  ),
);
check("no ambiguity in single-pickid resolution", r1.ambiguous.length === 0);

console.log("\noutcomes-oracle — multi-pickid slots are flagged ambiguous, not guessed");

const ambiguousLayout = makeLayout({
  // Slot 0 has TWO correct teams (bucket/set semantics) → must not resolve.
  swissPickids: [[12, 89], [95], [], [], [], [], [], [], [], []],
  playoffPickids: [],
  openPickids: [],
});
const r2 = resolveOutcomesFromLayout(ambiguousLayout);
check("the multi-pickid slot is NOT resolved", !r2.resolved.some((s) => s.slotIndex === 0));
check("the single-pickid slot still resolves", r2.resolved.some((s) => s.slotIndex === 1 && s.winnerPickId === 95));
check("the multi-pickid slot is reported ambiguous", r2.ambiguous.length === 1 && r2.ambiguous[0].slotIndex === 0);

console.log("\noutcomes-oracle — OPEN groups are never resolved (results can't predate lock)");

const openWithData = makeLayout({
  swissPickids: Array.from({ length: 10 }, () => []),
  playoffPickids: [],
  openPickids: [12], // pickids present on an OPEN group — must be ignored
});
const r3 = resolveOutcomesFromLayout(openWithData);
check("an OPEN group's populated slot is ignored", r3.resolved.length === 0 && r3.ambiguous.length === 0);

console.log("\n" + pass + "/" + (pass + fail) + " checks passed");
process.exit(fail === 0 ? 0 : 1);
