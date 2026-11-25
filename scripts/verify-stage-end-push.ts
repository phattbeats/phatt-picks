/**
 * verify-stage-end-push - offline proof for the stage-end push (PHA-5498).
 *
 * The notice has to fire at exactly one moment: when EVERY pick slot of a
 * Swiss stage has a resolved outcome. This proves the trigger without a live
 * stage — feed it a layout plus a partial outcome set (no push) and a
 * complete one (push) — and checks the surrounding wiring:
 *
 *   - the payload says the stage is done and NOTHING about the results;
 *   - the preference is its own (`stageEnd`), defaulting to push-on and
 *     respecting an explicit opt-out;
 *   - the sender is armed on the scheduler tick and honours the preference.
 *
 * Run: node scripts/verify-stage-end-push.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { latestCompletedSwissSectionId } from "../src/lib/stage-end-core.ts";
import { buildStageEndPayload } from "../src/lib/notify-core.ts";
import { parseNotifPrefs } from "../src/lib/notifications-core.ts";
import type { Layout } from "../src/lib/layout.ts";
import type { OutcomeMap } from "../src/lib/scoring.ts";

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

console.log("\nstage-end-push - PHA-5498\n");

// ---------------------------------------------------------------- trigger ---
console.log("trigger (stage complete = every slot resolved)");

/** A layout with one group of `slots` pick slots per section. */
function layoutWith(sections: Array<{ id: number; slots: number }>): Layout {
  return {
    event: 27,
    sections: sections.map((s) => ({
      sectionid: s.id,
      name: `Stage ${s.id}`,
      groups: [{ groupid: s.id * 100, picks: Array.from({ length: s.slots }, (_, i) => ({ index: i })) }],
    })),
  } as unknown as Layout;
}

/** Outcomes for one section: `filled` of `slots` slots resolved. */
function outcomes(sectionId: number, filled: number, slots: number): OutcomeMap {
  const map: OutcomeMap = {};
  const group = sectionId * 100;
  map[sectionId] = { [group]: {} };
  for (let i = 0; i < filled; i++) map[sectionId][group][i] = 1000 + i;
  void slots;
  return map;
}

const oneStage = layoutWith([{ id: 111, slots: 4 }]);
check(
  "a stage with NO resolved slot → no notice",
  latestCompletedSwissSectionId(oneStage, outcomes(111, 0, 4)) === null,
);
check(
  "a PARTIALLY resolved stage → no notice (this is the bug the recap push shipped)",
  latestCompletedSwissSectionId(oneStage, outcomes(111, 3, 4)) === null,
);
check(
  "a fully resolved stage → the notice fires",
  latestCompletedSwissSectionId(oneStage, outcomes(111, 4, 4)) === 111,
);

const twoStages = layoutWith([
  { id: 111, slots: 2 },
  { id: 112, slots: 2 },
]);
check(
  "the most recent completed stage wins (layout order, not id order)",
  latestCompletedSwissSectionId(twoStages, { 111: { 11100: { 0: 1, 1: 2 } }, 112: { 11200: { 0: 3, 1: 4 } } }) === 112,
);
check(
  "only the completed stage is eligible",
  latestCompletedSwissSectionId(twoStages, { 111: { 11100: { 0: 1, 1: 2 } }, 112: { 11200: { 0: 3 } } }) === 111,
);
check(
  "a playoff section is not a Swiss stage — no notice (no spoiler-free there)",
  latestCompletedSwissSectionId(layoutWith([{ id: 114, slots: 2 }]), { 114: { 11400: { 0: 1, 1: 2 } } }) === null,
);
check(
  "a stage with no groups can never be complete",
  latestCompletedSwissSectionId(
    { event: 27, sections: [{ sectionid: 111, groups: [] }] } as unknown as Layout,
    { 111: { 0: { 0: 1 } } },
  ) === null,
);

// ---------------------------------------------------------------- payload ---
console.log("\npayload");
{
  const payload = buildStageEndPayload({ stageName: "Stage I", sectionId: 111 });
  check("the title names the stage", payload.title === "Stage I is done");
  check("the body points at spoiler-free", /spoiler-free/i.test(payload.body));
  check(
    "the body reveals no result (no score, no team)",
    !/\d\s*[-–]\s*\d/.test(payload.body) && !/beat|won|lost|\d-\d/.test(payload.body),
  );
  check("the deep link goes to that stage's picks tab", payload.url === "/picks?section=111");
  check("the tag is per stage (duplicates collapse client-side)", payload.tag === "stage-end:111");
  check(
    "the action button says see results",
    (payload.actions ?? []).some((a) => /see results/i.test(a.title)),
  );
}

// ------------------------------------------------------------ preferences ---
console.log("\npreferences");
{
  const defaults = parseNotifPrefs(null);
  check("stageEnd is its own preference", "stageEnd" in defaults);
  check("the stage-end notice pushes by default", defaults.stageEnd.push === true);
  check("it has no in-app card (the recap entry covers the in-app side)", defaults.stageEnd.inApp === false);
  check(
    "an opt-out is honoured",
    parseNotifPrefs(JSON.stringify({ stageEnd: { inApp: false, push: false } })).stageEnd.push === false,
  );
  check(
    "a stored pref without stageEnd falls back to the default",
    parseNotifPrefs(JSON.stringify({ recap: { inApp: true, push: true } })).stageEnd.push === true,
  );
  check(
    "the recap preference is untouched by the new one",
    parseNotifPrefs(JSON.stringify({ stageEnd: { inApp: false, push: false } })).recap.push === false,
  );
  check("garbage prefs fall back to the defaults", parseNotifPrefs("{oops").stageEnd.push === true);
}

// ---------------------------------------------------------------- wiring ---
console.log("\nwiring (source-level)");
{
  const instrumentation = read("src/instrumentation.ts");
  const sender = read("src/lib/stage-end-pushes.ts");
  const core = read("src/lib/stage-end-core.ts");
  const panel = read("src/components/NotifPrefsPanel.tsx");

  check("the scheduler tick arms the stage-end push", /runStageEndPushes/.test(instrumentation));
  check(
    "the sender honours the preference per player",
    /prefsById\.get\(playerId\)\?\.stageEnd\.push/.test(sender),
  );
  check(
    "the sender sends once per stage per process (fired set)",
    /const fired = new Set<number>\(\)/.test(sender) && /fired\.add\(sectionId\)/.test(sender),
  );
  check(
    "the sender only reaches players with a push subscription",
    /prisma\.pushSubscription\.findMany/.test(sender),
  );
  check(
    "the trigger reuses the shared stage-complete rule",
    /isStageFullyResolved/.test(core) && /from "\.\/stage-wrapped-launch-core"/.test(core),
  );
  check("the stage name comes from the event registry, not a literal", /event\.sectionNames\[sectionId\]/.test(sender));
  check("the preference panel exposes the new kind", /kind: "stageEnd"/.test(panel));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
