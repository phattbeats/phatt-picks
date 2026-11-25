/**
 * verify-spoiler-free - offline proof for the spoiler-free revision of PHA-5495.
 *
 * Two guarantees are proved here:
 *
 * 1. THE RULES (spoiler-free-core, pure):
 *    - the mode is ON while the stage is underway and OFF before the stage
 *      starts and OFF once it is over;
 *    - a viewer's stored choice only applies within the phase it was made in,
 *      so an old choice cannot undermine the automatic switch-on;
 *    - the legacy bare "on"/"off" storage format is deliberately dropped.
 *
 * 2. THE WIRING (source-level): spoiler-free must mask the RESULT layer only.
 *    - the picks board must not be blurred (the viewer has to see what they
 *      picked);
 *    - the live bracket / standings must carry the mask class;
 *    - the picks page must drive the mode from the stage phase, not from
 *      "stage not complete".
 *
 * Run: node scripts/verify-spoiler-free.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  spoilerPhase,
  defaultSpoilerFree,
  parseStoredChoice,
  serializeChoice,
  resolveSpoilerState,
  createStoredChoiceReader,
  type SpoilerPhase,
} from "../src/lib/spoiler-free-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

console.log("\nspoiler-free - PHA-5495 revision (own picks stay visible)\n");

// ---------------------------------------------------------------- rules ----
console.log("phase rules");
check(
  "a stage that has not started is pre",
  spoilerPhase({ stageStarted: false, stageComplete: false }) === "pre",
);
check(
  "a started, unfinished stage is live",
  spoilerPhase({ stageStarted: true, stageComplete: false }) === "live",
);
check(
  "a finished stage is done",
  spoilerPhase({ stageStarted: true, stageComplete: true }) === "done",
);
check(
  "spoiler-free defaults OFF before the stage starts",
  defaultSpoilerFree("pre") === false,
);
check(
  "spoiler-free defaults ON while the stage is underway",
  defaultSpoilerFree("live") === true,
);
check(
  "spoiler-free defaults OFF once the stage is over",
  defaultSpoilerFree("done") === false,
);

console.log("\nstored choice");
check(
  "legacy bare 'on' is dropped (no phase to scope it to)",
  parseStoredChoice("on") === null,
);check(
  "legacy bare 'off' is dropped",
  parseStoredChoice("off") === null,
);
check(
  "garbage is dropped",
  parseStoredChoice("{oops") === null,
);
check(
  "a well-formed choice parses",
  parseStoredChoice('{"on":true,"phase":"live"}')?.on === true,
);
check(
  "a choice with an unknown phase is dropped",
  parseStoredChoice('{"on":true,"phase":"later"}') === null,
);
check(
  "a choice round-trips through serialize",
  parseStoredChoice(serializeChoice({ on: false, phase: "done" }))?.phase === "done",
);

console.log("\nresolution across the stage lifecycle");
{
  // No stored choice: the automatic default governs.
  check(
    "no stored choice -> off before the stage starts",
    resolveSpoilerState({ phase: "pre", stored: null }).on === false,
  );
  check(
    "no stored choice -> on when the stage starts",
    resolveSpoilerState({ phase: "live", stored: null }).on === true,
  );
  check(
    "no stored choice -> off when the stage ends",
    resolveSpoilerState({ phase: "done", stored: null }).on === false,
  );

  // A choice made BEFORE the stage started must not pre-empt the automatic
  // switch-on when the stage kicks off.
  const preChoice = { on: false, phase: "pre" as SpoilerPhase };
  check(
    "a choice made pre-start is honoured while still pre-start",
    resolveSpoilerState({ phase: "pre", stored: preChoice }).on === false,
  );
  check(
    "a choice made pre-start does NOT survive into the live phase",
    resolveSpoilerState({ phase: "live", stored: preChoice }).on === true,
  );

  // A choice made WHILE the stage is live survives the live phase (the page
  // auto-refreshes every 60s - the viewer's choice must stick).
  const liveChoice = { on: false, phase: "live" as SpoilerPhase };
  check(
    "a choice made mid-stage is honoured inside the live phase",
    resolveSpoilerState({ phase: "live", stored: liveChoice }).on === false,
  );
  check(
    "a mid-stage choice does NOT survive into the done phase",
    resolveSpoilerState({ phase: "done", stored: liveChoice }).on === false,
  );

  // The reverse: the viewer turned spoiler-free OFF mid-stage, then the stage
  // ends -> results are shown again.
  check(
    "the done phase shows results regardless of a mid-stage 'off'",
    resolveSpoilerState({ phase: "done", stored: liveChoice }).on === false,
  );

  // A choice made mid-stage to turn it OFF stays off while the stage runs, and
  // the stored choice is reported back so the client can keep it.
  check(
    "the stored choice is reported back when it applies",
    resolveSpoilerState({ phase: "live", stored: liveChoice }).stored === liveChoice,
  );
  check(
    "an out-of-phase stored choice is reported as none",
    resolveSpoilerState({ phase: "done", stored: liveChoice }).stored === null,
  );
}

// ------------------------------------------------------- snapshot stability ---
// React error #185 ("Maximum update depth exceeded"): useSyncExternalStore
// requires getSnapshot to return a STABLE value. Parsing the stored JSON on
// every call returns a new object, React tears the tree down and the picks
// page goes blank the moment a choice exists. This is the regression guard.
console.log("\nsnapshot stability (React error #185)");
{
  const store = new Map<string, string>();
  const fake = { getItem: (k: string) => (store.has(k) ? store.get(k)! : null) };
  const reader = createStoredChoiceReader("sf:27:111", fake);

  store.set("sf:27:111", JSON.stringify({ on: true, phase: "live" }));
  const first = reader();
  const second = reader();
  const third = reader();
  check("the reader returns the choice", first?.on === true && first?.phase === "live");
  check("the reader returns the SAME reference on every call", first === second && second === third);

  store.set("sf:27:111", JSON.stringify({ on: false, phase: "live" }));
  const changed = reader();
  check("a changed stored value produces a new snapshot", changed !== first);
  check("the new snapshot is honoured", changed?.on === false);
  check("the new snapshot is stable too", changed === reader());

  store.set("sf:27:111", "on"); // legacy format
  const legacy = reader();
  check("a legacy value reads as no choice", legacy === null);
  check("and is stable", legacy === reader());

  const throwing = {
    getItem: () => {
      throw new Error("storage blocked");
    },
  };
  const blocked = createStoredChoiceReader("sf:27:111", throwing);
  check("blocked storage reads as no choice (and does not throw)", blocked() === null);
  const missing = createStoredChoiceReader("sf:27:111", null);
  check("no storage at all reads as no choice", missing() === null);
}

// --------------------------------------------------------------- wiring ----
console.log("\nwiring (source-level)");
{
  const css = read("src/app/styles/sg-picks.css");
  const board = read("src/components/heat/LockedPicksBoard.tsx");
  const page = read("src/app/(app)/picks/page.tsx");
  const spoiler = read("src/components/SpoilerFree.tsx");

  check(
    "the results container is NOT blurred wholesale",
    !/\.sf-results\.sf-on\s*\{[^}]*filter:\s*blur/.test(css),
  );
  check(
    "the result views are masked via .sf-hide",
    /\.sf-results\.sf-on \.sf-hide\s*\{[^}]*filter:\s*blur/.test(css),
  );
  check(
    "the confirm marks are hidden while spoiler-free is on",
    /\.sf-results\.sf-on \.sgp-slot \.hit/.test(css) &&
      /\.sf-results\.sf-on \.sgp-slot \.miss/.test(css),
  );
  check(
    "the green/red confirm bar is dropped while spoiler-free is on",
    /\.sf-results\.sf-on \.sgp-slot\.good/.test(css) &&
      /\.sf-results\.sf-on \.sgp-slot\.bad/.test(css),
  );
  check(
    "the pick's own logo is NOT hidden while spoiler-free is on",
    !/\.sf-results\.sf-on \.sgp-mark[^}]*opacity:\s*0/.test(css),
  );
  check(
    "the slot tooltip carries no outcome wording",
    /title=\{team\.name\}/.test(board) &&
      !/title=\{`\$\{team\.name\} —/.test(board),
  );
  check(
    "the outcome wording moved onto the confirm mark",
    /className="hit" title=\{meta\.title\}/.test(board),
  );
  check(
    "the live bracket is masked (.sf-hide)",
    /className="sf-hide"[\s\S]{0,40}<\/LiveSwissBracketSim>|className="sf-hide"/.test(page) &&
      /<LiveSwissBracketSim[\s\S]{0,600}className="sf-hide"/.test(page),
  );
  check(
    "the standings are masked (.sf-hide)",
    /<LiveSwissStandings[\s\S]{0,600}className="sf-hide"/.test(page),
  );
  check(
    "the mode is driven by the stage phase, not by 'stage not complete'",
    /<SpoilerFree[^>]*phase=\{spoilerPhaseValue\}/.test(page) &&
      !/defaultOn=\{!stageComplete\}/.test(page),
  );
  check(
    "the client component takes a phase, not a defaultOn flag",
    /phase: SpoilerPhase/.test(spoiler) && !/defaultOn/.test(spoiler),
  );
  check(
    "the stored choice is read through the memoised reader",
    /createStoredChoiceReader/.test(spoiler),
  );
  check(
    "the component does NOT parse the stored JSON inside getSnapshot",
    !/parseStoredChoice\(window\.localStorage/.test(spoiler),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
