/**
 * verify-event-layout-scope — no live path reads another event's layout (PHA-1406).
 *
 * getCommittedLayout() is Cologne's fixture whatever event is live. Seventeen
 * call sites used it to score, validate and label the CURRENT event, so once
 * Singapore went live every Valve result was rejected as "unknown
 * section/group", the leaderboard scored 0 and Steam picks were dropped, with
 * no error anywhere. Live code must use scoringLayoutFor(eventId) (server) or
 * committedLayoutFor(eventId). This guard fails CI when a new caller appears
 * outside the allowlist below.
 *
 * Run: node scripts/verify-event-layout-scope.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { normalizeOutcomes } from "../src/lib/outcomes-core.ts";

/** Callers that are allowed, each with the reason. */
const ALLOWED: Record<string, string> = {
  "src/lib/layout.ts": "defines it",
  "src/components/sg/teams/team-data.ts": "last-resort fallback only when the live event has no fixture",
};

const root = new URL("..", import.meta.url).pathname;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

let fail = 0;
const offenders: string[] = [];
for (const file of walk(join(root, "src"))) {
  const rel = relative(root, file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (/^\s*\*/.test(code)) return;
    if (/\bgetCommittedLayout\s*\(/.test(code) && !(rel in ALLOWED)) offenders.push(`${rel}:${i + 1}`);
  });
}

if (offenders.length > 0) {
  fail++;
  console.error("  FAIL  getCommittedLayout() called outside the allowlist (use scoringLayoutFor / committedLayoutFor):");
  for (const o of offenders) console.error("        " + o);
} else {
  console.log("  PASS  no live path reads getCommittedLayout() outside the allowlist");
}
// PHA-5275: no live path may hardcode Cologne's playoff sections. QF/SF/GF
// derive from the registry (playoffRoundsFor / playoffSectionIdsForEvent /
// playoffSealUnitFor), so a bare 108/109/110 outside the files below is a
// Cologne assumption that breaks Singapore's 114/115/116. Comments and string
// literals are ignored.
const PLAYOFF_LITERAL_ALLOWED: Record<string, string> = {
  "src/lib/lock-schedule-core.ts": "Cologne's committed playoff schedule + section names (registry data)",
  "src/lib/regions-core.ts": "pickid 110 is Eternal Fire",
  "src/lib/team-stats-sources.ts": "pickid 110 is Eternal Fire",
  "src/lib/team-stats-singapore.ts": "pickid 110 is Eternal Fire",
};
const literalOffenders: string[] = [];
for (const file of walk(join(root, "src"))) {
  const rel = relative(root, file);
  if (rel in PLAYOFF_LITERAL_ALLOWED) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const code = line
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
      .replace(/\/\/.*$/, "");
    if (/^\s*\*/.test(code) || /^\s*\/\*/.test(code)) return;
    if (/(?<![\w.])(108|109|110)(?![\w.])/.test(code)) literalOffenders.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}
if (literalOffenders.length > 0) {
  fail++;
  console.error("  FAIL  bare Cologne playoff section id (108/109/110) in live code (derive it from the registry):");
  for (const o of literalOffenders) console.error("        " + o);
} else {
  console.log("  PASS  no bare 108/109/110 in live code outside the allowlist");
}

// The failure this guard exists for, reproduced on the real validator: a
// Singapore Stage I result checked against Cologne's fixture is rejected,
// against Singapore's own layout it resolves.
let pass = (offenders.length === 0 ? 1 : 0) + (literalOffenders.length === 0 ? 1 : 0);
{
  const load = (f: string) => JSON.parse(readFileSync(join(root, "src/fixtures", f), "utf8")).result;
  const cologne = load("cologne-layout.json");
  const singapore = load("pgl-singapore-2026-layout.json");
  const slot = { sectionId: 111, groupId: 281, slotIndex: 0, winnerPickId: 1 }; // NIP, Stage I
  const vsCologne = normalizeOutcomes(cologne, [slot], "valve");
  const vsSingapore = normalizeOutcomes(singapore, [slot], "valve");
  const ok1 = vsCologne.outcomes.length === 0 && vsCologne.rejected[0]?.reason === "unknown section/group";
  const ok2 = vsSingapore.outcomes.length === 1 && vsSingapore.rejected.length === 0;
  for (const [name, ok] of [
    ["Cologne's fixture rejects a Singapore result (the bug)", ok1],
    ["Singapore's own layout resolves it", ok2],
  ] as const) {
    if (ok) { pass++; console.log("  PASS  " + name); } else { fail++; console.error("  FAIL  " + name); }
  }
}
console.log(`\nevent-layout-scope: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
