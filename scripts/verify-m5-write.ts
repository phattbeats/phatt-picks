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
 *   2. single-pick upload body (PHA-853): each call carries unsuffixed
 *      sectionid/groupid/index/pickid/itemid — the indexed batch shape Valve
 *      rejects with "Required parameter 'sectionid' is missing". A whole
 *      Swiss stage is N sequential single-pick calls, not one indexed call.
 *   3. playoff bracket order (§0.1): the resolved picks list orders QF(108) →
 *      SF(109) → GF(110), regardless of input order, so the per-pick loop
 *      submits in bracket-correct sequence.
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

  // The same itemid survives resolve → single-pick body → URL param verbatim.
  const pick: LocalPick = { sectionId: 105, groupId: 271, slotIndex: 0, pickId: 89, itemId: "" };
  const body = buildUploadBody(AUTH, resolveUploadPick(pick, itemsMap));
  check("upload body itemid == exact string", body.get("itemid") === "17293822569790899385", String(body.get("itemid")));

  // What rule #2 prevents: a naive parse corrupts that id.
  const naive = (JSON.parse(fixture("cologne-items.json")) as { result: { items: { teamid: number; itemid: number }[] } })
    .result.items.find((i) => i.teamid === 89)!.itemid;
  check("JSON.parse WOULD corrupt it (why rule #2 exists)", String(naive) !== "17293822569790899385", `JSON.parse→${naive}`);
}

// [2] single-pick upload body (PHA-853 — Valve rejects the indexed batch).
function proveSinglePickShape(): void {
  console.log("\n[2] SINGLE-PICK BODY (PHA-853) — unsuffixed params per upload");
  // A representative pick from Stage I (section 105, group 271, slot 0).
  const pick: LocalPick = {
    sectionId: 105,
    groupId: 271,
    slotIndex: 0,
    pickId: teamIds[0],
    itemId: "",
  };
  const body = buildUploadBody(AUTH, resolveUploadPick(pick, itemsMap));

  check("auth params present (key/event/steamid/steamidkey)",
    body.get("key") === "K" && body.get("event") === "26" &&
    body.get("steamid") === AUTH.steamid && body.get("steamidkey") === AUTH.steamidkey);
  check("pick params are unsuffixed (sectionid, not sectionid1)",
    body.get("sectionid") === "105" && body.get("sectionid1") === null);
  check("slot goes in `index` (not `slot` / not `index1`)",
    body.get("index") === "0" && body.get("index1") === null);
  check("pickid + itemid present once each",
    body.get("pickid") === String(teamIds[0]) && body.get("itemid") === itemsMap.get(teamIds[0]));
  check("body carries exactly one pick worth of params (no indexed leftovers)",
    [...body.keys()].filter((k) => /\d$/.test(k)).length === 0);
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

  // PHA-853: each ordered pick becomes its own single-pick body — first is a
  // QF, last is the GF, so the per-pick upload loop submits in bracket order.
  const first = buildUploadBody(AUTH, ordered[0]);
  const last = buildUploadBody(AUTH, ordered[ordered.length - 1]);
  check("first ordered pick body targets QF section 108", first.get("sectionid") === "108");
  check("last ordered pick body targets GF section 110", last.get("sectionid") === "110");
  check("playoff sections constant matches layout", JSON.stringify([...PLAYOFF_SECTION_IDS]) === "[108,109,110]");
}

// [4] graceful degrade vs escalate (rules #7/#8).
function proveFailureClassification(): void {
  console.log("\n[4] FAILURE HANDLING — documented = degrade (#7); unexpected = escalate (#8)");
  // 5xx joined the degradable set in PHA-853: Valve emits bare-body 500s under
  // write load, indistinguishable from rate-limiting — keep the local pick.
  for (const s of [403, 404, 410, 412, 429, 500, 502, 503, 504]) {
    check(`status ${s} → degrade (keep local)`, classifyWriteFailure(s) === "degrade");
  }
  for (const s of [401, 418]) {
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
proveSinglePickShape();
provePlayoffOrder();
proveFailureClassification();
proveResolveGuards();
console.log(`\n${failures === 0 ? "M5 WRITE CHECKS PASSED" : `M5 WRITE CHECKS FAILED — ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
