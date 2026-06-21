/**
 * smoke-major-wrapped — end-to-end smoke for the Hotline (Major) Wrapped go-live
 * (PHA-1274). Brandon: "smoke test first then wire it."
 *
 * This drives the EXACT chain the Sunday routine will run, through the real
 * production builders (not hand-built bracket objects):
 *
 *   committed Cologne layout fixture
 *     → seed the QF with the 8 playoff teams + a simulated full result
 *     → buildPlayoffBracket({ sections, winnerByGroup })   [real live-board builder]
 *     → isPlayoffWrapped(bracket)                           [the GF gate]
 *     → derivePlayoffStorylines(bracket, { seedOf, nameOf}) [the storyline brain]
 *     → buildPlayoffWrappedDeck(facts, personal, assets)    [the deck]
 *
 * and asserts the deck that comes out is complete and correct — champion named,
 * road derived, every team page, the photos, the heartfelt close, the Hotline
 * stinger. If this is green, wiring the gated launcher is safe.
 *
 * Run: npx tsx scripts/smoke-major-wrapped.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlayoffBracket, isPlayoffSection } from "../src/lib/playoff-bracket-core.ts";
import type { Layout, Section } from "../src/lib/layout.ts";
import { isPlayoffWrapped, derivePlayoffStorylines } from "../src/lib/playoff-wrapped-derive.ts";
import { buildPlayoffWrappedDeck, COLOGNE_PLAYOFF_TEAMS, type PlayoffWrappedAssets, type PlayoffWrappedPersonal } from "../src/lib/playoff-wrapped-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const layout: Layout = (JSON.parse(readFileSync(join(ROOT, "src/fixtures/cologne-layout.json"), "utf8")) as { result: Layout }).result;

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.error("  FAIL  " + name + (detail ? `  (${detail})` : "")); }
};

// ---- The Cologne playoff field: names + seeds (1 = top). ----
const NAMES: Record<number, string> = {
  85: "FURIA", 89: "Vitality", 81: "Spirit", 139: "Falcons",
  134: "Aurora", 59: "G2", 137: "BetBoom", 112: "9z",
};
const SEED: Record<number, number> = { 85: 1, 89: 2, 81: 3, 139: 4, 134: 5, 59: 6, 137: 7, 112: 8 };
const assets: PlayoffWrappedAssets = {
  resolveTeamLogo: (id) => (NAMES[id] ? { tiers: [], name: NAMES[id] } : null),
  majorLogoSrc: "/watch/iem-cologne.png",
  gameLogoSrc: "/watch/counter-strike.png",
};
const opts = { seedOf: (id: number) => SEED[id] ?? null, nameOf: (id: number) => NAMES[id] ?? null };

// ---- Build the live bracket the production way: real sections + a full result. ----
const sections: Section[] = JSON.parse(JSON.stringify(layout.sections.filter((s) => isPlayoffSection(s.sectionid)))) as Section[];
check("found the 3 committed playoff sections (108/109/110)", sections.length === 3, `got ${sections.length}`);
const sec = (id: number) => sections.find((s) => s.sectionid === id)!;
const gid = (id: number, idx: number) => sec(id).groups[idx].groupid;

// Simulate a fully-played-out bracket: every round seeded with the teams that
// advanced into it (this is the state the live board is in once Valve has
// filled the bracket down to the Final — the derive walks each round's match).
const QF: Array<[number, number]> = [[85, 134], [112, 137], [81, 59], [139, 89]];
QF.forEach(([a, b], i) => { sec(108).groups[i].teams = [{ pickid: a }, { pickid: b }]; });
const SF: Array<[number, number]> = [[85, 112], [81, 139]];
SF.forEach(([a, b], i) => { sec(109).groups[i].teams = [{ pickid: a }, { pickid: b }]; });
sec(110).groups[0].teams = [{ pickid: 85 }, { pickid: 81 }]; // GF: FURIA vs Spirit

// Simulated full result → FURIA champion, Spirit runner-up, Falcons the #4-over-#2 buster.
const winnerByGroup = new Map<number, number>([
  [gid(108, 0), 85], [gid(108, 1), 112], [gid(108, 2), 81], [gid(108, 3), 139], // QF
  [gid(109, 0), 85], [gid(109, 1), 81],                                          // SF (fed by QF winners)
  [gid(110, 0), 85],                                                             // GF
]);
const scoreByGroup = new Map<number, readonly [number, number]>([[gid(110, 0), [3, 1] as const]]);

const bracket = buildPlayoffBracket({ sections, winnerByGroup, scoreByGroup });

console.log("\nsmoke - the GF gate");
check("bracket crowned a champion (FURIA)", bracket.championPickid === 85, `got ${bracket.championPickid}`);
check("isPlayoffWrapped → true once the GF is decided", isPlayoffWrapped(bracket));
check("an in-flight bracket (no GF winner) is NOT wrapped",
  !isPlayoffWrapped(buildPlayoffBracket({ sections, winnerByGroup: new Map([[gid(108, 0), 85]]) })));

console.log("\nsmoke - the storyline brain derives from results (nothing hand-authored)");
const facts = derivePlayoffStorylines(bracket, opts);
check("champion derived as FURIA", facts.championPickId === 85);
check("runner-up derived as Spirit", facts.runnerUpPickId === 81, `got ${facts.runnerUpPickId}`);
check("Grand Final score carried (3-1)", (facts.finalScore ?? "").includes("3"));
check("champion road has all three legs (QF→SF→GF)", (facts.championPath ?? []).length === 3, `got ${(facts.championPath ?? []).length}`);
check("bracket-buster derived (the #4-over-#2 upset)", !!facts.bracketBuster);
check("a Cinderella moment derived from the seeds", (facts.moments ?? []).some((m) => m.id === "po-d-cinderella"));

console.log("\nsmoke - the deck the routine will publish");
const personal: PlayoffWrappedPersonal = {
  displayName: "Emily", avatar: { src: null, label: "Emily" },
  bracketHits: 5, bracketResolved: 7, championPickId: 85, rankAfter: 2,
  rankMove: { delta: 3, direction: "up" }, reactionsPlaced: 4,
};
const deck = buildPlayoffWrappedDeck(facts, personal, assets);
const ids = deck.map((s) => s.id);
check("deck is a full 'big finish' (15+ slides)", deck.length >= 15, `got ${deck.length}`);
check("opens on the Major cover", ids[0] === "po-intro");
check("champion slide names FURIA", /FURIA/.test(deck.find((s) => s.id === "po-champion")?.headline ?? ""));
check("champion slide carries a real photo", !!deck.find((s) => s.id === "po-champion")?.photo?.src);
check("all eight team pages present", COLOGNE_PLAYOFF_TEAMS.every((t) => ids.includes(`po-team-${t.pickId}`)));
check("matched champion lights 'YOU CALLED THE CHAMPION'", deck.find((s) => s.id === "po-your-champion")?.calledIt?.label === "YOU CALLED THE CHAMPION");
check("heartfelt -phaTT thank-you present", /phaTT/.test(deck.find((s) => s.id === "po-thanks")?.body ?? ""));
check("has the 'Hotline will return' stinger", deck.some((s) => /Hotline will return/.test(s.headline ?? "")));
check("closes on the challenge-coin CTA (after everything else)", deck[deck.length - 1]?.id === "po-coin");
check("every photo slide carries a credited src", deck.filter((s) => s.photo).every((s) => !!s.photo!.src && !!s.photo!.credit));

console.log(`\nsmoke-major-wrapped: ${pass} passed, ${fail} failed`);
console.log(`\nDERIVED DECK (${deck.length} slides): ${ids.join(", ")}`);
process.exit(fail === 0 ? 0 : 1);
