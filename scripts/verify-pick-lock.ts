/**
 * verify-pick-lock — offline proof of the self-sealed picks rules
 * (src/lib/pick-lock-core.ts).
 *
 *   - sealing is allowed only while the stage is open, complete, and once
 *   - edits to a sealed stage are rejected (stage gate still wins when closed)
 *   - visibility gate: stage lock OR self OR public seal; a hidden seal hides
 *   - hidden → public allowed; public → hidden and unseal rejected
 *   - the Steam mirror skips sealed units and flags divergence only after a match
 *   - playoffs seal as one unit; metrics maths
 *
 * Run: node --experimental-strip-types scripts/verify-pick-lock.ts
 */

import {
  arePlayerPicksVisible,
  canChangeVisibility,
  canEditPicks,
  canSeal,
  canUnseal,
  fmtLead,
  initialSteamMatched,
  median,
  nextSteamState,
  parseVisibility,
  partitionMirror,
  PLAYOFF_SEAL_UNIT,
  sealMetrics,
  sealUnitFor,
  sectionsInUnit,
  slotKey,
  visibilityReason,
} from "../src/lib/pick-lock-core.ts";

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
const reason = (d: { ok: boolean; reason?: string }) => (d.ok ? "ok" : d.reason);

console.log("\npick-lock - seal units");
check("Swiss section is its own unit", sealUnitFor(105) === 105 && sealUnitFor(107) === 107);
check("QF/SF/GF all collapse onto the QF unit", [108, 109, 110].every((s) => sealUnitFor(s) === PLAYOFF_SEAL_UNIT));
check("playoff unit covers 108/109/110", sectionsInUnit(PLAYOFF_SEAL_UNIT).join(",") === "108,109,110");
check("Swiss unit covers only itself", sectionsInUnit(106).join(",") === "106");
check("parseVisibility strict", parseVisibility("public") === "public" && parseVisibility("hidden") === "hidden" && parseVisibility("PUBLIC") === null && parseVisibility(1) === null);

console.log("\npick-lock - sealing allowed only while open");
const base = { stageWritable: true, filled: 10, total: 10, existing: null, visibility: "public" };
check("open + complete + unsealed → ok", reason(canSeal(base)) === "ok");
check("stage locked → stage_locked", reason(canSeal({ ...base, stageWritable: false })) === "stage_locked");
check("incomplete → incomplete", reason(canSeal({ ...base, filled: 9 })) === "incomplete");
check("empty unit (total 0) → incomplete", reason(canSeal({ ...base, filled: 0, total: 0 })) === "incomplete");
check("already sealed → already_sealed", reason(canSeal({ ...base, existing: { visibility: "hidden" } })) === "already_sealed");
check("bad visibility → 400", (() => {
  const d = canSeal({ ...base, visibility: "everyone" });
  return !d.ok && d.reason === "bad_visibility" && d.status === 400;
})());
check("hidden seal allowed too", reason(canSeal({ ...base, visibility: "hidden" })) === "ok");

console.log("\npick-lock - edits rejected after sealing");
check("open + unsealed → edit ok", reason(canEditPicks({ stageWritable: true, sealed: false })) === "ok");
check("open + sealed → picks_sealed", reason(canEditPicks({ stageWritable: true, sealed: true })) === "picks_sealed");
check("closed stage → stage_locked wins", reason(canEditPicks({ stageWritable: false, sealed: true })) === "stage_locked");
check("rejections are 409s", (() => {
  const d = canEditPicks({ stageWritable: true, sealed: true });
  return !d.ok && d.status === 409;
})());

console.log("\npick-lock - visibility gate");
const pub = { visibility: "public" };
const hid = { visibility: "hidden" };
check("open, no seal, other viewer → hidden", !arePlayerPicksVisible({ stageRevealed: false, isSelf: false, seal: null }));
check("open, hidden seal, other viewer → hidden", !arePlayerPicksVisible({ stageRevealed: false, isSelf: false, seal: hid }));
check("open, public seal, other viewer → visible", arePlayerPicksVisible({ stageRevealed: false, isSelf: false, seal: pub }));
check("open, self → visible", arePlayerPicksVisible({ stageRevealed: false, isSelf: true, seal: null }));
check("locked stage → visible regardless", arePlayerPicksVisible({ stageRevealed: true, isSelf: false, seal: hid }));
check("reason: public-seal marker only pre-lock", visibilityReason({ stageRevealed: false, isSelf: false, seal: pub }) === "public-seal" && visibilityReason({ stageRevealed: true, isSelf: false, seal: pub }) === "stage");
check("reason: hidden", visibilityReason({ stageRevealed: false, isSelf: false, seal: hid }) === "hidden");

console.log("\npick-lock - visibility transitions");
check("hidden → public allowed", reason(canChangeVisibility(hid, "public")) === "ok");
check("public → hidden rejected", reason(canChangeVisibility(pub, "hidden")) === "public_is_final");
check("public → public no-op", (() => {
  const d = canChangeVisibility(pub, "public");
  return d.ok && d.noop === true;
})());
check("change without a seal → not_sealed", reason(canChangeVisibility(null, "public")) === "not_sealed");
check("unseal always rejected", reason(canUnseal()) === "seal_is_final");

console.log("\npick-lock - Steam mirror skips sealed units");
const snapshot = new Map<string, number>([
  [slotKey(105, 271, 0), 11],
  [slotKey(105, 271, 1), 12],
  [slotKey(108, 274, 0), 21],
  [slotKey(109, 278, 0), 21],
]);
const preds = [
  { sectionId: 105, groupId: 271, slotIndex: 0, pickId: 11 },
  { sectionId: 105, groupId: 271, slotIndex: 1, pickId: 12 },
  { sectionId: 106, groupId: 272, slotIndex: 0, pickId: 31 },
  { sectionId: 108, groupId: 274, slotIndex: 0, pickId: 21 },
  { sectionId: 109, groupId: 278, slotIndex: 0, pickId: 99 },
];
const split = partitionMirror(preds, new Set([105, PLAYOFF_SEAL_UNIT]), snapshot);
check("only the unsealed section is mirrored", split.mirror.length === 1 && split.mirror[0].sectionId === 106);
check("sealed Swiss unit matching Valve → match", split.matchByUnit.get(105) === true);
check("playoff unit with a changed SF pick → mismatch", split.matchByUnit.get(PLAYOFF_SEAL_UNIT) === false);
check("unsealed section not reported", !split.matchByUnit.has(106));
const partial = partitionMirror(preds.slice(0, 1), new Set([105]), snapshot);
check("Valve missing a sealed slot → not a match", partial.matchByUnit.get(105) === false);
check("no seals → mirror everything", partitionMirror(preds, new Set(), snapshot).mirror.length === preds.length);

console.log("\npick-lock - divergence flag");
const t0 = new Date("2026-11-20T10:00:00Z");
const t1 = new Date("2026-11-21T10:00:00Z");
const t2 = new Date("2026-11-22T10:00:00Z");
const never = { steamMatchedAt: null, steamDivergedAt: null };
check("mismatch before ever matching → no flag (not pushed yet)", nextSteamState(never, false, t1).steamDivergedAt === null);
const matched = nextSteamState(never, true, t0);
check("match records matchedAt", matched.steamMatchedAt === t0 && matched.steamDivergedAt === null);
const diverged = nextSteamState(matched, false, t1);
check("mismatch after a match → flagged", diverged.steamDivergedAt === t1);
check("flag keeps its first timestamp", nextSteamState(diverged, false, t2).steamDivergedAt === t1);
check("matching again clears the flag", nextSteamState(diverged, true, t2).steamDivergedAt === null);
check("baseline matched iff every pick on Steam", initialSteamMatched([{ pickId: 1, isLocal: false }, { pickId: 0, isLocal: true }]) && !initialSteamMatched([{ pickId: 1, isLocal: true }]) && !initialSteamMatched([]));

console.log("\npick-lock - metrics");
check("median odd/even/empty", median([3, 1, 2]) === 2 && median([1, 2, 3, 4]) === 2.5 && median([]) === null);
const lockAt = Date.parse("2026-11-25T10:00:00Z");
const m = sealMetrics({
  playersWithPicks: 8,
  stageLockAtMs: lockAt,
  seals: [
    { initialVisibility: "public", visibility: "public", lockedAtMs: lockAt - 3_600_000 },
    { initialVisibility: "public", visibility: "public", lockedAtMs: lockAt - 7_200_000 },
    { initialVisibility: "hidden", visibility: "public", lockedAtMs: lockAt - 10_800_000 },
    { initialVisibility: "hidden", visibility: "hidden", lockedAtMs: lockAt - 14_400_000 },
  ],
});
check("sealed 4 of 8 → 50%", m.sealed === 4 && m.sealedPct === 50);
check("chose public 2 / hidden 2 → 50%", m.chosePublic === 2 && m.choseHidden === 2 && m.publicPct === 50);
check("one hidden → public convert", m.converted === 1);
check("median lead 2.5h", m.medianLeadMs === 9_000_000);
check("no lock time → null lead", sealMetrics({ playersWithPicks: 1, stageLockAtMs: null, seals: [{ initialVisibility: "public", visibility: "public", lockedAtMs: 0 }] }).medianLeadMs === null);
check("no players → null pct", sealMetrics({ playersWithPicks: 0, stageLockAtMs: null, seals: [] }).sealedPct === null);
check("fmtLead buckets", fmtLead(null) === "—" && fmtLead(38 * 60_000) === "38m" && fmtLead(150 * 60_000) === "2h 30m" && fmtLead(52 * 3_600_000) === "2d 4h");

console.log(`\npick-lock: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
