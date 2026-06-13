/**
 * verify-stage-wrapped — offline proof for the Stage Wrapped deck core
 * (PHA-1052). The popup shell delegates all "which slide am I on" logic to the
 * pure reducer in stage-wrapped-core, so this exercises:
 *   - clampIndex never escapes [0, count-1] and handles empty decks
 *   - deckReducer next/prev clamp at the ends (no wrap / no overshoot)
 *   - goto + reset behave
 *   - first/last/progress derivations
 *   - the per-stage seen-key is stable and event+section scoped
 *   - the placeholder deck is well-formed (non-empty, unique ids, headlines)
 *
 * Run: node --experimental-strip-types --import ./register-ts-resolve.mjs \
 *        --no-warnings scripts/verify-stage-wrapped.ts
 * (or via scripts/verify-all.mjs)
 */

import {
  buildPlaceholderSlides,
  clampIndex,
  deckReducer,
  initialDeckState,
  isFirstSlide,
  isLastSlide,
  progressLabel,
  stageWrappedKey,
  wrappedSeenKey,
  type DeckState,
} from "../src/lib/stage-wrapped-core.ts";

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

console.log("\nstage-wrapped - clampIndex");
check("clamp below 0 -> 0", clampIndex(-3, 5) === 0);
check("clamp above count -> count-1", clampIndex(9, 5) === 4);
check("clamp in range unchanged", clampIndex(2, 5) === 2);
check("empty deck clamps to 0", clampIndex(2, 0) === 0);
check("negative count clamps to 0", clampIndex(1, -4) === 0);
check("truncates fractional index", clampIndex(2.9, 5) === 2);

console.log("\nstage-wrapped - deckReducer paging");
let st: DeckState = initialDeckState(4);
check("initial index 0 / count 4", st.index === 0 && st.count === 4);
st = deckReducer(st, { type: "next" });
check("next -> 1", st.index === 1);
st = deckReducer(deckReducer(st, { type: "next" }), { type: "next" });
check("next x2 -> 3 (last)", st.index === 3);
st = deckReducer(st, { type: "next" });
check("next on last clamps (stays 3, no wrap)", st.index === 3);
st = deckReducer(st, { type: "prev" });
check("prev -> 2", st.index === 2);
st = deckReducer(deckReducer(deckReducer(st, { type: "prev" }), { type: "prev" }), { type: "prev" });
check("prev past start clamps to 0", st.index === 0);

console.log("\nstage-wrapped - goto + reset");
st = deckReducer(initialDeckState(6), { type: "goto", index: 4 });
check("goto 4 -> 4", st.index === 4);
st = deckReducer(st, { type: "goto", index: 99 });
check("goto out of range clamps to last", st.index === 5);
st = deckReducer(st, { type: "reset", count: 3 });
check("reset rebuilds count + cursor to 0", st.index === 0 && st.count === 3);
check("reset negative count -> 0", deckReducer(st, { type: "reset", count: -2 }).count === 0);

console.log("\nstage-wrapped - derivations");
check("isFirst on fresh deck", isFirstSlide(initialDeckState(4)));
check("isLast on last slide", isLastSlide({ index: 3, count: 4 }));
check("isLast on empty deck (no Next target)", isLastSlide({ index: 0, count: 0 }));
check("not last mid-deck", !isLastSlide({ index: 1, count: 4 }));
check("progress label 1-based", progressLabel({ index: 2, count: 4 }) === "3 / 4");
check("progress label empty deck", progressLabel({ index: 0, count: 0 }) === "0 / 0");

console.log("\nstage-wrapped - seen-key scoping");
check("seen-key is event+section scoped", wrappedSeenKey(26, 105) !== wrappedSeenKey(26, 106));
check("seen-key differs across events", wrappedSeenKey(26, 105) !== wrappedSeenKey(27, 105));
check("seen-key stable for same stage", wrappedSeenKey(26, 105) === wrappedSeenKey(26, 105));
check("seen-key is versioned", wrappedSeenKey(26, 105).includes("wrapped-seen:v1"));
check("stageWrappedKey is event:section", stageWrappedKey(26, 105) === "26:105");

console.log("\nstage-wrapped - placeholder deck shape");
const slides = buildPlaceholderSlides("Stage I");
check("placeholder deck is non-empty", slides.length >= 3);
check("every slide has a non-empty headline", slides.every((s) => s.headline.trim().length > 0));
check("every slide id is unique", new Set(slides.map((s) => s.id)).size === slides.length);
check("eyebrow carries the stage name", slides[0].eyebrow?.includes("STAGE I") === true);

console.log(`\nstage-wrapped: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
