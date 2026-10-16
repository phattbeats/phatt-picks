/**
 * verify-coach — offline proof for the coach marks (blue bubbles) and the
 * display-name fitting used by the compare hero / podium / profile hero.
 *
 * Coach marks (lib/coach-core):
 *   1. Audience: a stored audience sticks; pre-redesign accounts and devices
 *      with legacy localStorage traces are "returning"; everyone else "new".
 *   2. Route patterns: "/" exact, "/x/*" prefix, "@self" own profile only.
 *   3. Eligibility: off → nothing; seen tips drop out; audience filters.
 *   4. Sequencing: the first eligible tip with an on-screen anchor shows.
 *   5. Persistence parse is tolerant; reset keeps the audience.
 *   6. Placement flips above when there's no room below, clamps to the viewport.
 * Name fit (lib/name-fit):
 *   7. Short names fit on one line; long names wrap on spaces, never narrower
 *      than their longest word; spaceless names stay on one line up to 24.
 *   8. Only names over 35 chars are clamped.
 *
 * Run: node scripts/verify-coach.ts
 */

import {
  COACH_TIPS,
  REDESIGN_CUTOFF_MS,
  nextTip,
  parseTipsState,
  placeBubble,
  resetTips,
  resolveAudience,
  routeMatches,
  serializeTipsState,
  tipsForPage,
  markSeen,
  type TipsState,
} from "../src/lib/coach-core.ts";
import { NAME_FIT_MAX, nameFit, nameLineChars } from "../src/lib/name-fit.ts";

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

// 1. audience
const before = REDESIGN_CUTOFF_MS - 86_400_000;
const after = REDESIGN_CUTOFF_MS + 86_400_000;
check("stored audience sticks", resolveAudience({ stored: "new", accountCreatedAtMs: before, hasLegacyVisit: true }) === "new");
check("pre-redesign account → returning", resolveAudience({ stored: null, accountCreatedAtMs: before, hasLegacyVisit: false }) === "returning");
check("legacy device trace → returning", resolveAudience({ stored: null, accountCreatedAtMs: null, hasLegacyVisit: true }) === "returning");
check("fresh account, fresh device → new", resolveAudience({ stored: null, accountCreatedAtMs: after, hasLegacyVisit: false }) === "new");
check("anonymous fresh device → new", resolveAudience({ stored: null, accountCreatedAtMs: null, hasLegacyVisit: false }) === "new");

// 2. routes
check("'/' is exact", routeMatches("/", "/", null) && !routeMatches("/", "/picks", null));
check("'/picks/*' covers /picks and below", routeMatches("/picks/*", "/picks", null) && routeMatches("/picks/*", "/picks/107", null));
check("'/picks/*' doesn't match /picksx", !routeMatches("/picks/*", "/picksx", null));
check("'@self' only on own profile", routeMatches("@self", "/players/p1", "p1") && !routeMatches("@self", "/players/p2", "p1"));
check("'@self' never for anonymous", !routeMatches("@self", "/players/p1", null));
check("trailing slash tolerated", routeMatches("/leaderboard", "/leaderboard/", null));

// 3. eligibility
const fresh = (aud: TipsState["aud"]): TipsState => ({ v: 2, aud, seen: [], off: false });
const homeNew = tipsForPage(COACH_TIPS, { path: "/", selfId: null, state: fresh("new") }).map((t) => t.id);
const homeRet = tipsForPage(COACH_TIPS, { path: "/", selfId: null, state: fresh("returning") }).map((t) => t.id);
check("new player home: path tour first, no NEW tips", homeNew[0] === "tour-path" && !homeNew.some((id) => id.startsWith("new-")));
check("returning home: NEW tips, no beginner tour", homeRet.includes("new-look") && !homeRet.some((id) => id.startsWith("tour-")));
check("off → no tips", tipsForPage(COACH_TIPS, { path: "/", selfId: null, state: { ...fresh("new"), off: true } }).length === 0);
check("undecided audience → no tips", tipsForPage(COACH_TIPS, { path: "/", selfId: null, state: fresh(null) }).length === 0);
const seenPath = markSeen(fresh("new"), "tour-path");
check("seen tip drops out", !tipsForPage(COACH_TIPS, { path: "/", selfId: null, state: seenPath }).some((t) => t.id === "tour-path"));
check("'all' tips reach both audiences", ["new", "returning"].every((aud) =>
  tipsForPage(COACH_TIPS, { path: "/leaderboard/compare", selfId: null, state: fresh(aud as "new") }).some((t) => t.id === "react")));
check("coin tip only on your own profile",
  tipsForPage(COACH_TIPS, { path: "/players/me", selfId: "me", state: fresh("new") }).some((t) => t.id === "tour-coins") &&
  !tipsForPage(COACH_TIPS, { path: "/players/you", selfId: "me", state: fresh("new") }).some((t) => t.id === "tour-coins"));
check("tip ids are unique", new Set(COACH_TIPS.map((t) => t.id)).size === COACH_TIPS.length);
check("copy stays short (≤3 lines, ≤60 chars each)", COACH_TIPS.every((t) => t.body.length <= 3 && t.body.every((l) => l.length <= 60)));

// 4. sequencing
const picks = tipsForPage(COACH_TIPS, { path: "/picks", selfId: null, state: fresh("new") });
check("first on-screen tip wins", nextTip(picks, new Set(["picks-buckets", "picks-dossier"]))?.id === "tour-buckets");
check("off-screen anchor is skipped", nextTip(picks, new Set(["picks-dossier"]))?.id === "tour-dossier");
check("nothing on screen → null", nextTip(picks, new Set()) === null);

// 5. persistence
check("garbage parses as fresh", parseTipsState("{not json").aud === null && parseTipsState(null).seen.length === 0);
check("bad fields are dropped", parseTipsState('{"aud":"admin","seen":[1,"x"],"off":"yes"}').aud === null &&
  parseTipsState('{"aud":"admin","seen":[1,"x"],"off":"yes"}').seen.join() === "x" &&
  parseTipsState('{"off":"yes"}').off === false);
const round = parseTipsState(serializeTipsState({ v: 2, aud: "returning", seen: ["a", "a", "b"], off: true }));
check("round-trip dedupes seen", round.aud === "returning" && round.seen.join() === "a,b" && round.off);
const reset = resetTips({ v: 2, aud: "returning", seen: ["a"], off: true });
check("reset clears seen + off, keeps audience", reset.aud === "returning" && reset.seen.length === 0 && !reset.off);

// 6. placement
const vp = { width: 390, height: 844 };
const bub = { width: 300, height: 150 };
const low = placeBubble({ anchor: { top: 780, left: 20, width: 40, height: 40 }, bubble: bub, viewport: vp });
check("flips above near the bottom edge", low.side === "top" && low.top + bub.height <= 780);
const high = placeBubble({ anchor: { top: 10, left: 340, width: 40, height: 40 }, bubble: bub, viewport: vp });
check("below by default, clamped right", high.side === "bottom" && high.left + bub.width <= vp.width - 12 && high.left >= 12);
check("arrow points at the anchor centre", high.arrowX === 360 - high.left || high.arrowX === bub.width - 18);
const inset = placeBubble({ anchor: { top: 600, left: 100, width: 100, height: 40 }, bubble: bub, viewport: vp, bottomInset: 120 });
check("bottom nav inset forces it above", inset.side === "top");

// 7–8. name fit
check("short name fits one line", nameLineChars("phaTT") === 5 && nameLineChars("Brandolorian") === 12);
const long = "The Unbelievably Long Name Haver X"; // 34 chars
check("34-char name wraps to ~half, ≥ longest word", nameLineChars(long) >= 12 && nameLineChars(long) <= 19);
check("spaceless 20-char name stays one line", nameLineChars("xXTheAwpGodFromBRxXy") === 20);
check("spaceless 30-char name breaks at half", nameLineChars("abcdefghijklmnopqrstuvwxyz1234") === 16);
check("≤35 chars never clamped", !nameFit("x".repeat(NAME_FIT_MAX)).className.includes("nfit-clamp"));
check(">35 chars clamped", nameFit("x".repeat(NAME_FIT_MAX + 1)).className.includes("nfit-clamp"));
check("extra class is kept", nameFit("phaTT", "cmp-big").className.split(" ").includes("cmp-big"));

console.log(`\nverify-coach: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
