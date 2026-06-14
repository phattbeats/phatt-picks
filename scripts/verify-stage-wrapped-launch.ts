/**
 * verify-stage-wrapped-launch — offline proof for the app-wide Stage Wrapped
 * auto-launch selector (PHA-1051). The full resolver (`stage-wrapped-launch.ts`)
 * pulls prisma; this pins the pure decision it leans on:
 *
 *   - latestWrappedSectionId picks the LAST (layout-order) section that is BOTH
 *     resolved (in the outcome map) AND authored (Stage Wrapped content exists).
 *   - A resolved-but-UNAUTHORED stage (e.g. Stage III 107 before its moments
 *     are written) is skipped — it never pops an empty deck.
 *   - An authored-but-UNRESOLVED stage is skipped — no leak before lock.
 *   - "Latest" follows layout order, not numeric id.
 *   - No qualifying stage → null (the launcher stays inert).
 *
 * Run: node --experimental-strip-types --import ./register-ts-resolve.mjs \
 *        --no-warnings scripts/verify-stage-wrapped-launch.ts
 * (or via scripts/verify-all.mjs)
 */

import { latestWrappedSectionId } from "../src/lib/stage-wrapped-launch-core.ts";
import type { Layout } from "../src/lib/layout.ts";
import type { OutcomeMap } from "../src/lib/scoring.ts";

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

// Minimal layout: only `sections[].sectionid` is read by the selector. Sections
// 105/106 are authored (real Stage Wrapped content); 107 (Stage III) is not.
const layout = {
  sections: [{ sectionid: 105 }, { sectionid: 106 }, { sectionid: 107 }],
} as unknown as Layout;

// A resolved section just needs *a* key in the outcome map.
const resolved = (...ids: number[]): OutcomeMap => {
  const m: OutcomeMap = {};
  for (const id of ids) m[id] = { 0: { 0: 1 } };
  return m;
};

check("no outcomes → null (inert before any stage resolves)", latestWrappedSectionId(layout, resolved()) === null);
check("only 105 resolved+authored → 105", latestWrappedSectionId(layout, resolved(105)) === 105);
check("105 & 106 resolved+authored → 106 (latest by layout order)", latestWrappedSectionId(layout, resolved(105, 106)) === 106);
check("107 resolved but UNAUTHORED → null (no empty-deck popup)", latestWrappedSectionId(layout, resolved(107)) === null);
check("106 authored + 107 unauthored, both resolved → 106", latestWrappedSectionId(layout, resolved(106, 107)) === 106);
check("all resolved, but only authored ones count → 106", latestWrappedSectionId(layout, resolved(105, 106, 107)) === 106);

// Authored-but-unresolved must NOT be picked (105 authored, but not resolved here).
check("authored 105 unresolved → null", latestWrappedSectionId(layout, resolved()) === null);

// Layout order, not numeric id: reverse the order so 105 is "latest".
const reversed = { sections: [{ sectionid: 107 }, { sectionid: 106 }, { sectionid: 105 }] } as unknown as Layout;
check("layout order wins: reversed sections, both authored resolved → 105", latestWrappedSectionId(reversed, resolved(105, 106)) === 105);

console.log(`\nverify-stage-wrapped-launch: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
