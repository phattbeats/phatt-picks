/**
 * verify-stage-wrapped-launch — offline proof for the app-wide Stage Wrapped
 * auto-launch selector (#1051). The full resolver (`stage-wrapped-launch.ts`)
 * pulls prisma; this pins the pure decision it leans on:
 *
 *   - latestWrappedSectionId picks the LAST (layout-order) section that is BOTH
 *     resolved (in the outcome map) AND authored (Stage Wrapped content exists).
 *   - A resolved-but-UNAUTHORED stage (e.g. Playoffs 108 before its moments
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
// 105/106/107 are authored (real Stage Wrapped content); 108 (Playoffs) is not.
const sec = (sectionid: number) => ({ sectionid, groups: [{ groupid: 0, picks: [{ index: 0 }, { index: 1 }] }] });
const layout = {
  event: 26,
  sections: [sec(105), sec(106), sec(107), sec(108)],
} as unknown as Layout;

// A resolved section just needs *a* key in the outcome map.
const resolved = (...ids: number[]): OutcomeMap => {
  const m: OutcomeMap = {};
  for (const id of ids) m[id] = { 0: { 0: 1, 1: 2 } };
  return m;
};

check("no outcomes → null (inert before any stage resolves)", latestWrappedSectionId(layout, resolved()) === null);
check("only 105 resolved+authored → 105", latestWrappedSectionId(layout, resolved(105)) === 105);
check("105 & 106 resolved+authored → 106 (latest by layout order)", latestWrappedSectionId(layout, resolved(105, 106)) === 106);
check("105/106/107 resolved+authored → 107 (latest by layout order)", latestWrappedSectionId(layout, resolved(105, 106, 107)) === 107);
check("108 resolved but UNAUTHORED → null (no empty-deck popup)", latestWrappedSectionId(layout, resolved(108)) === null);
check("107 authored + 108 unauthored, both resolved → 107", latestWrappedSectionId(layout, resolved(107, 108)) === 107);
check("all resolved, but only authored ones count → 107", latestWrappedSectionId(layout, resolved(105, 106, 107, 108)) === 107);

// Authored-but-unresolved must NOT be picked (105 authored, but not resolved here).
check("authored 105 unresolved → null", latestWrappedSectionId(layout, resolved()) === null);

// Layout order, not numeric id: reverse the order so 105 is "latest".
const reversed = { event: 26, sections: [sec(107), sec(106), sec(105)] } as unknown as Layout;
check("layout order wins: reversed sections, both authored resolved → 105", latestWrappedSectionId(reversed, resolved(105, 106)) === 105);

// PHA-5275: a resolved Singapore stage gets its (plain) Stage Wrapped; its
// playoff sections never get a stage deck, and Cologne's ids don't count.
const sg = { event: 27, sections: [sec(111), sec(112), sec(113), sec(114)] } as unknown as Layout;
check("Singapore Stage I resolved → 111", latestWrappedSectionId(sg, resolved(111)) === 111);
check("Singapore Stage II + QF resolved → 112 (playoffs have no stage deck)", latestWrappedSectionId(sg, resolved(111, 112, 114)) === 112);

// Brandon 2026-11-25: recap fired days early. A PARTIALLY resolved stage (some slots
// have winners, the stage's last game day has not happened) must NOT qualify.
const partial: OutcomeMap = { 105: { 0: { 0: 1 } } }; // slot 1 still open
check("partially resolved stage (1 of 2 slots) → null (recap waits for the last game day)", latestWrappedSectionId(layout, partial) === null);
check("105 complete + 106 partial → 105 (the unfinished stage does not steal the recap)", latestWrappedSectionId(layout, { ...resolved(105), 106: { 0: { 0: 1 } } }) === 105);
check("stage with no groups can never be complete", latestWrappedSectionId({ event: 26, sections: [{ sectionid: 105 }] } as unknown as Layout, resolved(105)) === null);

console.log(`\nverify-stage-wrapped-launch: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
