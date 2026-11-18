/**
 * verify-singapore-playoffs — the Singapore bracket end to end (PHA-5275).
 *
 * Every playoff path was hardcoded to Cologne's 108/109/110, so on Singapore's
 * 114/115/116 /picks showed three plain tabs, SF/GF picks were rejected, the
 * Steam bracket upload was a silent no-picks, the bracket sealed as three
 * units and Major Wrapped never launched (or would have shown Cologne). This
 * runs the committed Singapore layout with seeded QFs through the same pure
 * cores the pages and API routes use:
 *   1. the bracket picker mounts (rounds QF/SF/GF, seeded tree, field of 8),
 *   2. ONE ordered bracket upload covers all seven picks,
 *   3. the bracket seals as ONE unit,
 *   4. Major Wrapped builds with Singapore content and nothing from Cologne.
 *
 * Run: node --experimental-strip-types --import ./register-ts-resolve.mjs scripts/verify-singapore-playoffs.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Layout, Section } from "../src/lib/layout.ts";
import {
  buildPlayoffBracket,
  buildPlayoffPickTree,
  isPlayoffSection,
  playoffFieldTeams,
  playoffRoundsFor,
  resolveBracketPicks,
} from "../src/lib/playoff-bracket-core.ts";
import { isPlayoffSection as writeIsPlayoff, orderPicks, playoffSectionIdsForEvent, type UploadPick } from "../src/lib/write-core.ts";
import { playoffSealUnitFor, sealUnitFor, sectionsInUnit } from "../src/lib/pick-lock-core.ts";
import { derivePlayoffStorylines, isPlayoffWrapped } from "../src/lib/playoff-wrapped-derive.ts";
import { buildPlayoffWrappedDeck, COLOGNE_EDITION, playoffWrappedEditionFor } from "../src/lib/playoff-wrapped-core.ts";
import { spotlightForPickid, authoredSpotlightPickids } from "../src/lib/playoff-spotlights.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const layout: Layout = (JSON.parse(readFileSync(join(ROOT, "src/fixtures/pgl-singapore-2026-layout.json"), "utf8")) as { result: Layout }).result;

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.error("  FAIL  " + name + (detail ? `  (${detail})` : "")); }
};

// Seed the QFs with the Stage III field (the eight Valve seeds in on the day).
const sections: Section[] = JSON.parse(JSON.stringify(layout.sections.filter((s) => isPlayoffSection(s.sectionid)))) as Section[];
const QF: Array<[number, number]> = [[106, 89], [85, 134], [81, 152], [139, 126]];
const qf = sections.find((s) => s.sectionid === 114)!;
QF.forEach(([a, b], i) => { qf.groups[i].teams = [{ pickid: a }, { pickid: b }] as Section["groups"][number]["teams"]; });

console.log("\n[1] bracket picker mounts on 114/115/116");
check("layout is Singapore's (event 27)", layout.event === 27);
check("the three playoff sections are 114/115/116", sections.map((s) => s.sectionid).join(",") === "114,115,116");
check("rounds derive QF114 → SF115 → GF116", playoffRoundsFor(27).map((r) => `${r.key}${r.sectionId}`).join(",") === "QF114,SF115,GF116");
check("write-core agrees on playoff sections", [114, 115, 116].every(writeIsPlayoff) && !writeIsPlayoff(113));
const tree = buildPlayoffPickTree(sections);
check("pick tree is 4 → 2 → 1", tree.rounds.map((r) => r.matches.length).join(",") === "4,2,1");
check("QF sides carry the seeded teams", tree.rounds[0].matches[0].top.seed === 106 && tree.rounds[0].matches[3].bottom.seed === 126);
check("Grand Final group is 290", tree.finalGroupId === 290);
const field = playoffFieldTeams(sections);
check("field is the eight seeded QF teams (SF/GF eligibility)", field.size === 8 && QF.flat().every((p) => field.has(p)));
// The viewer advances 106, 85, 81, 139 and so on to a champion.
const raw = { 284: 106, 285: 85, 286: 81, 287: 139, 288: 106, 289: 81, 290: 106 };
const resolved = resolveBracketPicks(tree, raw);
check("a full bracket of advanced picks resolves (no SF/GF rejected)", Object.keys(resolved.picks).length === 7 && resolved.championPickid === 106);
check("SF/GF picks are field teams the API accepts", [106, 81].every((p) => field.has(p)));

console.log("\n[2] one ordered bracket upload");
check("upload set is the event's three sections", JSON.stringify(playoffSectionIdsForEvent(27)) === "[114,115,116]");
const groupSection = new Map(sections.flatMap((s) => s.groups.map((g) => [g.groupid, s.sectionid] as const)));
const picks: UploadPick[] = Object.entries(raw)
  .map(([g, p]) => ({ sectionId: groupSection.get(Number(g))!, groupId: Number(g), slotIndex: 0, pickId: p, itemId: "1" }))
  .filter((p) => playoffSectionIdsForEvent(27).includes(p.sectionId))
  .reverse();
const ordered = orderPicks(picks);
check("all seven picks ride the one bracket call", ordered.length === 7);
check("ordered QF → SF → GF", ordered.map((p) => `${p.sectionId}/${p.groupId}`).join(" ") === "114/284 114/285 114/286 114/287 115/288 115/289 116/290");

console.log("\n[3] the bracket seals as one unit");
check("seal unit is the QF (114)", playoffSealUnitFor(27) === 114);
check("QF/SF/GF all collapse onto 114", [114, 115, 116].every((s) => sealUnitFor(s) === 114));
check("the unit covers the whole bracket", sectionsInUnit(114).join(",") === "114,115,116");
check("Stage III is still its own unit", sealUnitFor(113) === 113);

console.log("\n[4] Major Wrapped launches with Singapore content");
const winnerByGroup = new Map(Object.entries(raw).map(([g, p]) => [Number(g), p]));
// Downstream slots fill as the bracket plays out.
const sf = sections.find((s) => s.sectionid === 115)!;
sf.groups[0].teams = [{ pickid: 106 }, { pickid: 85 }] as Section["groups"][number]["teams"];
sf.groups[1].teams = [{ pickid: 81 }, { pickid: 139 }] as Section["groups"][number]["teams"];
const gf = sections.find((s) => s.sectionid === 116)!;
gf.groups[0].teams = [{ pickid: 106 }, { pickid: 81 }] as Section["groups"][number]["teams"];
const bracket = buildPlayoffBracket({ sections, winnerByGroup });
check("the bracket crowns a champion on 116", isPlayoffWrapped(bracket) && bracket.championPickid === 106);
const edition = playoffWrappedEditionFor(27);
check("Singapore has its own Wrapped edition", edition?.city === "SINGAPORE" && edition !== COLOGNE_EDITION);
const facts = derivePlayoffStorylines(bracket, { nameOf: (id) => `Team ${id}`, edition: edition! });
facts.fieldPickIds = [...field];
const deck = buildPlayoffWrappedDeck(facts, null, { resolveTeamLogo: (id) => ({ tiers: [], name: `Team ${id}` }), majorLogoSrc: "/x.png" }, edition!);
const text = JSON.stringify(deck);
check("the deck builds", deck.length > 0 && deck.some((s) => s.id === "po-champion"));
check("champion slide is Singapore's", deck.find((s) => s.id === "po-champion")?.eyebrow === "CHAMPION OF SINGAPORE");
check("no Cologne copy, venue or photos", !/Cologne|Cathedral|LANXESS|\/wrapped\/major-/.test(text), text.match(/Cologne|Cathedral|LANXESS|\/wrapped\/major-/)?.[0]);
check("no Cologne moments", !deck.some((s) => /^po-m-/.test(s.id)));
check("every seeded team gets a card", QF.flat().every((p) => deck.some((s) => s.id === `po-team-${p}`)));
check("Cologne's deck is unchanged", JSON.stringify(buildPlayoffWrappedDeck(facts, null, {})).includes("CHAMPION OF COLOGNE"));

console.log("\n[5] spotlights are Singapore's, not Cologne's");
check("no Cologne spotlight on Singapore's FURIA (85)", spotlightForPickid(27, 85) === null && spotlightForPickid(26, 85) !== null);
check("Singapore's qualified strip starts empty", authoredSpotlightPickids(27).length === 0);

console.log(`\nverify-singapore-playoffs: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
