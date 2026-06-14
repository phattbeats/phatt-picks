/**
 * verify-stage-wrapped-content — offline proof for the Stage Wrapped content +
 * deck builder (PHA-1054). The shell (PHA-1052) is proven separately; this pins
 * the *content* invariants the popup leans on:
 *   - NO-OP: an unauthored section (e.g. Stage III 107, or any stage the caller
 *     hasn't authored) yields an EMPTY deck → the launcher never opens. This is
 *     the "verify it no-ops before Stage 1 resolves" guard at the data layer
 *     (paired with the reveal page's `resolved` gate).
 *   - Authored stages (105 / 106) produce a well-formed deck: intro first, the
 *     authored moments, then personal slides, then an outro; unique ids; every
 *     slide has a headline.
 *   - Personal slides appear only when personal data is supplied; signed-out
 *     gets moments + a sign-in outro with NO fabricated personal numbers.
 *   - The rank slide renders ▲/▼/—/#rank correctly from the rank move.
 *
 * Run: node --experimental-strip-types --import ./register-ts-resolve.mjs \
 *        --no-warnings scripts/verify-stage-wrapped-content.ts
 * (or via scripts/verify-all.mjs)
 */

import {
  buildStageWrappedDeck,
  stageWrappedHasContent,
  type StageWrappedAssets,
  type StageWrappedPersonal,
} from "../src/lib/stage-wrapped-content.ts";
import { stageNumeral } from "../src/lib/stage-wrapped-core.ts";

// Stub asset resolver — every pickid resolves to a monogram tier + a name, so
// the builder's logo-attachment path is exercised without the real manifest.
const ASSETS: StageWrappedAssets = {
  resolveTeamLogo: (id: number) => ({ tiers: [{ kind: "monogram", label: "XX" }], name: `team-${id}` }),
  majorLogoSrc: "/watch/iem-cologne.png",
  gameLogoSrc: "/watch/counter-strike.png",
};

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

const PERSONAL: StageWrappedPersonal = {
  displayName: "phaTT",
  stagePoints: 6,
  correct: 6,
  resolvedSlots: 10,
  totalPoints: 14,
  rankAfter: 3,
  rankMove: { delta: 4, direction: "up" },
  bestCall: { pickId: 132, teamName: "FlyQuest", tag: "3:2", pct: 9, count: 2, total: 22 },
  avatar: { src: null, label: "phaTT" },
};

/* ---- NO-OP invariant ---- */
const unauthored = buildStageWrappedDeck(107, "Stage III", PERSONAL);
check("unauthored section (107) yields an EMPTY deck (no-op)", unauthored.length === 0);
check("unauthored section with null personal is also empty", buildStageWrappedDeck(107, "Stage III", null).length === 0);
check("an entirely unknown section is empty", buildStageWrappedDeck(999, "Stage X", PERSONAL).length === 0);
check("stageWrappedHasContent: 105 true", stageWrappedHasContent(105) === true);
check("stageWrappedHasContent: 106 true", stageWrappedHasContent(106) === true);
check("stageWrappedHasContent: 107 false (not authored yet)", stageWrappedHasContent(107) === false);
check("stageWrappedHasContent: unknown false", stageWrappedHasContent(999) === false);

/* ---- Authored Stage I, personal ---- */
const s1 = buildStageWrappedDeck(105, "Stage I", PERSONAL);
check("Stage I deck is non-empty", s1.length > 0);
check("Stage I opens on the intro slide", s1[0]?.kind === "intro");
check("Stage I ends on the outro slide", s1[s1.length - 1]?.kind === "outro");
const s1ids = s1.map((s) => s.id);
check("Stage I slide ids are unique", new Set(s1ids).size === s1ids.length);
check("every Stage I slide has a non-empty headline", s1.every((s) => typeof s.headline === "string" && s.headline.length > 0));
check("Stage I carries 5 authored event moments", s1.filter((s) => s.id.startsWith("s1-")).length === 5);
check("Stage I has a FUCK YOUR PICK'EMS slide", s1.some((s) => s.id === "s1-fyp" && /PICK'EMS/.test(s.eyebrow ?? "")));
check("Stage I has the BIG 0-12 comeback moment", s1.some((s) => s.id === "s1-comeback-big-nrg" && /0-12/.test(s.figure ?? "")));
check("Stage I has the FlyQuest upset moment", s1.some((s) => s.id === "s1-upset-flyquest-liquid"));
check("Stage I has a personal score slide", s1.some((s) => s.id === "personal-score" && s.figure === "+6"));
check("personal score caption shows correct/resolved + total", s1.some((s) => s.id === "personal-score" && /6\/10/.test(s.figureCaption ?? "") && /14 total/.test(s.figureCaption ?? "")));
check("personal score headline uses the display name", s1.some((s) => s.id === "personal-score" && s.headline.includes("phaTT")));
check("Stage I has a personal rank slide", s1.some((s) => s.id === "personal-rank"));
check("Stage I has the personal best-call slide", s1.some((s) => s.id === "personal-best-call" && s.headline.includes("FlyQuest")));
check("best-call slide shows field share %", s1.some((s) => s.id === "personal-best-call" && s.figure === "9%"));
check("personal outro promises replay (button is wired)", s1.some((s) => s.kind === "outro" && /[Rr]eplay/.test(s.body ?? "")));

/* ---- Authored Stage II, personal ---- */
const s2 = buildStageWrappedDeck(106, "Stage II", PERSONAL);
check("Stage II deck is non-empty", s2.length > 0);
check("Stage II carries 5 authored event moments", s2.filter((s) => s.id.startsWith("s2-")).length === 5);
check("Stage II has a FUCK YOUR PICK'EMS slide", s2.some((s) => s.id === "s2-fyp" && /PICK'EMS/.test(s.eyebrow ?? "")));
check("Stage II has the donk/Spirit dominance moment", s2.some((s) => s.id === "s2-dominance-spirit-donk" && /10 rounds/.test(s.figure ?? "")));
check("Stage II has the Astralis drought moment", s2.some((s) => s.id === "s2-drought-astralis"));

/* ---- Best call absent → no best-call slide ---- */
const noBest = buildStageWrappedDeck(105, "Stage I", { ...PERSONAL, bestCall: null });
check("no best call → no best-call slide", !noBest.some((s) => s.id === "personal-best-call"));
check("no best call → still has score + rank slides", noBest.some((s) => s.id === "personal-score") && noBest.some((s) => s.id === "personal-rank"));

/* ---- Signed-out (personal null) ---- */
const out = buildStageWrappedDeck(105, "Stage I", null);
check("signed-out deck still has the intro + moments", out[0]?.kind === "intro" && out.some((s) => s.id.startsWith("s1-")));
check("signed-out deck has NO personal slides", !out.some((s) => s.id.startsWith("personal-")));
check("signed-out outro prompts sign-in", out.some((s) => s.kind === "outro" && /[Ss]ign in/.test(s.body ?? "")));

/* ---- Rank slide variants ---- */
function rankFigure(move: StageWrappedPersonal["rankMove"], rankAfter: number | null): string | undefined {
  const deck = buildStageWrappedDeck(105, "Stage I", { ...PERSONAL, rankMove: move, rankAfter });
  return deck.find((s) => s.id === "personal-rank")?.figure;
}
check("rank up → ▲N", rankFigure({ delta: 4, direction: "up" }, 3) === "▲4");
check("rank down → ▼N", rankFigure({ delta: 2, direction: "down" }, 9) === "▼2");
check("rank flat → —", rankFigure({ delta: 0, direction: "flat" }, 5) === "—");
check("rank new → #rank", rankFigure({ delta: null, direction: "new" }, 7) === "#7");
check("rank new with unknown rank → —", rankFigure({ delta: null, direction: "new" }, null) === "—");

/* ---- Visuals: logos / brand marks / avatar (Brandon: "more visuals") ---- */
const vis = buildStageWrappedDeck(105, "Stage I", PERSONAL, ASSETS);
const vIntro = vis.find((s) => s.kind === "intro");
const vOutro = vis.find((s) => s.kind === "outro");
const vUpset = vis.find((s) => s.id === "s1-upset-flyquest-liquid");
const vDom = buildStageWrappedDeck(106, "Stage II", PERSONAL, ASSETS).find((s) => s.id === "s2-dominance-spirit-donk");
const vScore = vis.find((s) => s.id === "personal-score");
const vBest = vis.find((s) => s.id === "personal-best-call");
check("intro carries the major brand logo", vIntro?.brandLogo?.src === "/watch/iem-cologne.png");
check("outro carries the game brand logo", vOutro?.brandLogo?.src === "/watch/counter-strike.png");
check("matchup moment has 2 team logos", (vUpset?.teamLogos?.length ?? 0) === 2);
check("matchup logos carry resolved tiers + names", !!vUpset?.teamLogos?.[0]?.tiers?.length && vUpset!.teamLogos![0].name === "team-132");
check("single-team moment has 1 logo", (vDom?.teamLogos?.length ?? 0) === 1);
check("personal score slide carries the viewer avatar", vScore?.avatar?.label === "phaTT");
check("best-call slide carries the called team's logo", (vBest?.teamLogos?.length ?? 0) === 1);

/* ---- Backward-compat: no assets → no visuals (text-only deck still valid) ---- */
const noAssets = buildStageWrappedDeck(105, "Stage I", PERSONAL);
check("no assets → moments have no teamLogos", noAssets.every((s) => s.teamLogos === undefined));
check("no assets → intro has no brandLogo", noAssets.find((s) => s.kind === "intro")?.brandLogo === undefined);
check("no assets → deck is still well-formed (intro..outro)", noAssets[0]?.kind === "intro" && noAssets[noAssets.length - 1]?.kind === "outro");

/* ---- Stage logos (HEAT v3 lockup): STAGE I / II / III ---- */
check("stageNumeral: 'Stage I' → I", stageNumeral("Stage I") === "I");
check("stageNumeral: 'Stage II' → II", stageNumeral("Stage II") === "II");
check("stageNumeral: 'Stage III' → III", stageNumeral("Stage III") === "III");
check("stageNumeral: numeric 'Stage 2' → II", stageNumeral("Stage 2") === "II");
const s1Intro = s1.find((s) => s.kind === "intro");
const s1Outro = s1.find((s) => s.kind === "outro");
const s2Intro = buildStageWrappedDeck(106, "Stage II", PERSONAL).find((s) => s.kind === "intro");
check("Stage I intro carries a STAGE badge with numeral I", s1Intro?.stageBadge?.numeral === "I" && s1Intro?.stageBadge?.label === "STAGE");
check("Stage I intro badge sub is WRAPPED", s1Intro?.stageBadge?.sub === "WRAPPED");
check("Stage II intro badge numeral is II", s2Intro?.stageBadge?.numeral === "II");
check("outro also carries a STAGE badge", !!s1Outro?.stageBadge?.numeral);

console.log(`\nverify-stage-wrapped-content: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
