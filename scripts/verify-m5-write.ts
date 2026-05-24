/**
 * M5 write-path verification — offline, against the committed fixtures.
 *
 * A live UploadTournamentPredictions is DESTRUCTIVE — it locks the owner's real
 * tournament stickers on Valve — so it is NOT run here (it's the deploy/event
 * smoke). Instead this exercises the exact pure code the live write uses, proving
 * the four things the M5 scope names:
 *
 *   1. itemids carried as exact digit strings read→write (rule #2): the live
 *      items fixture maps teamid→itemid losslessly, and the upload body emits
 *      that string verbatim — where a JSON.parse would silently corrupt it.
 *   2. stage-batched upload (§0.1): a whole Swiss stage goes in ONE indexed call
 *      (sectionid1…itemid1 … sectionidN…itemidN, slot in indexN).
 *   3. playoff bracket = its own single ORDERED call: QF(108) → SF(109) → GF(110),
 *      regardless of input order.
 *   4. graceful degrade vs escalate (rules #7/#8): documented Valve failures
 *      classify as "degrade" (keep local); unexpected status/shape "escalate".
 *
 * Run:  DATABASE_URL="file:./dev.db" node --env-file=.env scripts/verify-m5-write.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSafeJson } from "../src/lib/bigint.ts";
import { buildItemIdMap } from "../src/lib/items.ts";
import {
  resolveUploadPick,
  orderPicks,
  buildUploadBody,
  parseAssignedItemIds,
  classifyWriteFailure,
  WriteShapeError,
  PLAYOFF_SECTION_IDS,
  type LocalPick,
} from "../src/lib/write-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string) => readFileSync(join(ROOT, "src/fixtures", name), "utf8");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

const AUTH = { key: "K", event: 26, steamid: "76561197960287930", steamidkey: "AAAA-AAAAA-AAAA" };

// The real items map from the committed GetTournamentItems snapshot.
const itemsMap = buildItemIdMap(parseSafeJson(fixture("cologne-items.json")) as never);
const teamIds = [...itemsMap.keys()];

// [1] itemid precision read→write — the rule #2 trap end-to-end.
function proveItemidCarry(): void {
  console.log("\n[1] ITEMID CARRY (rule #2) — exact digit string from items map → upload body");
  check("items map built from 32 live team items", itemsMap.size === 32, `size=${itemsMap.size}`);

  // A real pair from the fixture (teamid 89's itemid).
  check("teamid 89 → exact itemid string", itemsMap.get(89) === "17293822569790899385", String(itemsMap.get(89)));
  check("map values are strings, never numbers", teamIds.every((t) => typeof itemsMap.get(t) === "string"));

  // The same itemid survives resolve → ordered batch → URL param verbatim.
  const pick: LocalPick = { sectionId: 105, groupId: 271, slotIndex: 0, pickId: 89, itemId: "" };
  const body = buildUploadBody(AUTH, [resolveUploadPick(pick, itemsMap)]);
  check("upload body itemid1 == exact string", body.get("itemid1") === "17293822569790899385", String(body.get("itemid1")));

  // What rule #2 prevents: a naive parse corrupts that id.
  const naive = (JSON.parse(fixture("cologne-items.json")) as { result: { items: { teamid: number; itemid: number }[] } })
    .result.items.find((i) => i.teamid === 89)!.itemid;
  check("JSON.parse WOULD corrupt it (why rule #2 exists)", String(naive) !== "17293822569790899385", `JSON.parse→${naive}`);
}

// [2] stage-batched upload — one indexed call for a whole Swiss stage (§0.1).
function proveStageBatch(): void {
  console.log("\n[2] STAGE BATCH (§0.1) — Stage I's 10 picks in ONE indexed call");
  // Build a full Stage I (section 105, group 271, slots 0-9) from real teams.
  const stagePicks: LocalPick[] = teamIds.slice(0, 10).map((teamId, slot) => ({
    sectionId: 105,
    groupId: 271,
    slotIndex: slot,
    pickId: teamId,
    itemId: "",
  }));
  const resolved = stagePicks.map((p) => resolveUploadPick(p, itemsMap));
  const body = buildUploadBody(AUTH, resolved);

  check("auth params present (key/event/steamid/steamidkey)",
    body.get("key") === "K" && body.get("event") === "26" &&
    body.get("steamid") === AUTH.steamid && body.get("steamidkey") === AUTH.steamidkey);
  check("10 picks → indexed 1..10 (1-based)", body.get("sectionid1") === "105" && body.get("sectionid10") === "105" && body.get("sectionid11") === null);
  check("slot goes in indexN (not the suffix)", body.get("index1") === "0" && body.get("index10") === "9");
  check("pickid/itemid paired per index", body.get("pickid3") === String(teamIds[2]) && body.get("itemid3") === itemsMap.get(teamIds[2]));
  check("single call carries the whole stage", [...body.keys()].filter((k) => k.startsWith("sectionid")).length === 10);
}

// [3] playoff bracket — one ordered call QF→SF→GF regardless of input order (§0.1).
function provePlayoffOrder(): void {
  console.log("\n[3] PLAYOFF BRACKET — single ordered call QF(108)→SF(109)→GF(110)");
  // Deliberately shuffled: GF, an SF, two QFs, the other SF, the rest of QFs.
  const raw: LocalPick[] = [
    { sectionId: 110, groupId: 280, slotIndex: 0, pickId: teamIds[0], itemId: "" }, // GF
    { sectionId: 109, groupId: 279, slotIndex: 0, pickId: teamIds[1], itemId: "" }, // SF2
    { sectionId: 108, groupId: 276, slotIndex: 0, pickId: teamIds[2], itemId: "" }, // QF3
    { sectionId: 108, groupId: 274, slotIndex: 0, pickId: teamIds[3], itemId: "" }, // QF1
    { sectionId: 109, groupId: 278, slotIndex: 0, pickId: teamIds[4], itemId: "" }, // SF1
    { sectionId: 108, groupId: 277, slotIndex: 0, pickId: teamIds[5], itemId: "" }, // QF4
    { sectionId: 108, groupId: 275, slotIndex: 0, pickId: teamIds[6], itemId: "" }, // QF2
  ];
  const ordered = orderPicks(raw.map((p) => resolveUploadPick(p, itemsMap)));
  const seq = ordered.map((p) => `${p.sectionId}/${p.groupId}`);
  check("sections emitted QF→SF→GF", JSON.stringify(seq) ===
    JSON.stringify(["108/274", "108/275", "108/276", "108/277", "109/278", "109/279", "110/280"]), seq.join(" "));

  const body = buildUploadBody(AUTH, ordered);
  check("body index1 is a QF (108), last is the GF (110)", body.get("sectionid1") === "108" && body.get("sectionid7") === "110");
  check("playoff sections constant matches layout", JSON.stringify([...PLAYOFF_SECTION_IDS]) === "[108,109,110]");
}

// [4] graceful degrade vs escalate (rules #7/#8).
function proveFailureClassification(): void {
  console.log("\n[4] FAILURE HANDLING — documented = degrade (#7); unexpected = escalate (#8)");
  for (const s of [403, 404, 410, 412, 429, 503, 504]) {
    check(`status ${s} → degrade (keep local)`, classifyWriteFailure(s) === "degrade");
  }
  for (const s of [401, 418, 500]) {
    check(`status ${s} → escalate (surface & block)`, classifyWriteFailure(s) === "escalate");
  }

  // Unexpected shape on a 200: an itemid that came back as a number (unsafe parse).
  let threw = false;
  try {
    parseAssignedItemIds({ result: { picks: [{ sectionid: 105, groupid: 271, index: 0, pickid: 89, itemid: 123 }] } } as never);
  } catch (e) {
    threw = e instanceof WriteShapeError;
  }
  check("number itemid in 200 body → WriteShapeError (escalate)", threw);

  // A clean 200 body yields the assigned itemid keyed by slot (adopt going forward).
  const assigned = parseAssignedItemIds(
    { result: { picks: [{ sectionid: 105, groupid: 271, index: 0, pickid: 89, itemid: "17293822569790899385" }] } } as never,
  );
  check("assigned itemid extracted by slot key", assigned.get("105:271:0") === "17293822569790899385");
}

// [5] resolve guards — an unset/unknown pick is unexpected → throws (caller escalates, #8).
function proveResolveGuards(): void {
  console.log("\n[5] RESOLVE GUARDS — unset/unresolvable picks throw (caller escalates, #8)");
  let unset = false;
  try { resolveUploadPick({ sectionId: 105, groupId: 271, slotIndex: 0, pickId: 0, itemId: "" }, itemsMap); }
  catch { unset = true; }
  check("pickId 0 (unset) rejected", unset);

  let missing = false;
  try { resolveUploadPick({ sectionId: 105, groupId: 271, slotIndex: 0, pickId: 999999, itemId: "" }, itemsMap); }
  catch { missing = true; }
  check("team with no itemid rejected (don't upload garbage)", missing);

  // Falls back to the itemid stored on the row when the live map lacks it.
  const fallback = resolveUploadPick(
    { sectionId: 105, groupId: 271, slotIndex: 0, pickId: 999999, itemId: "17293822569790899385" },
    itemsMap,
  );
  check("stored itemId used as fallback when map misses", fallback.itemId === "17293822569790899385");
}

console.log("=== phaTT Picks M5 write-path verification ===");
proveItemidCarry();
proveStageBatch();
provePlayoffOrder();
proveFailureClassification();
proveResolveGuards();
console.log(`\n${failures === 0 ? "M5 WRITE CHECKS PASSED" : `M5 WRITE CHECKS FAILED — ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
