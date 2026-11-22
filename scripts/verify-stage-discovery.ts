/**
 * verify-stage-discovery - offline proof for PHA-5358.
 *
 * A Swiss stage's lock, crawl window and HLTV source come from what HLTV has
 * published, with no code edit, and nothing is ever estimated:
 *   - real captures of Singapore's Stage I, Stage II and hub (8302) pages
 *     (crawled 2026-11-22) parse into the right first match and sibling links;
 *   - a FAKE published Stage III (the real hub header plus a timed Swiss
 *     bracket) wires section 113 into the registry on its own;
 *   - the same page with matchups but no times, or with TBD slots, stays dark;
 *   - the picks-page reveal rule shows the bracket once matchups are out.
 *
 * Run: node scripts/verify-stage-discovery.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseHltvEventPage,
  stageNumberOfSection,
  stageNumbersFromTitle,
  firstPublishedMatchMs,
  hasPublishedMatchups,
  stageFactsFromPage,
  linkStagesToSections,
  liveBracketVisible,
  WINDOW_END_GRACE_MS,
  type StageFacts,
} from "../src/lib/stage-discovery-core.ts";
import { parseSwissBracket } from "../src/lib/swiss-bracket-core.ts";
import {
  BASE_EVENTS,
  EVENTS,
  getEventConfig,
  mergeStageFacts,
  setStageFacts,
  clearStageFacts,
  validateEventRevealConfig,
  stageOneStartFor,
} from "../src/lib/events-core.ts";
import { isBracketRevealed, isWithinRefreshWindow, lockTimeForSection } from "../src/lib/lock-schedule-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name + (detail ? `  (${detail})` : ""));
  }
}

const SG = BASE_EVENTS[27];
const s1Html = read("src/fixtures/hltv-sg-stage1-upcoming.sample.html");
const s2Html = read("src/fixtures/hltv-sg-stage2-upcoming.sample.html");
const hubHtml = read("src/fixtures/hltv-sg-hub-upcoming.sample.html");
const HUB_URL = "https://www.hltv.org/events/8302/pgl-major-singapore-2026";

console.log("\nstage-discovery - stage numbers");
check("Stage III -> 3", stageNumberOfSection("Stage III") === 3);
check("Stage 2 -> 2", stageNumberOfSection("Stage 2") === 2);
check("Quarterfinals -> null", stageNumberOfSection("Quarterfinals") === null);
check('"Stage 3 & Playoffs" -> [3]', stageNumbersFromTitle("Stage 3 & Playoffs").join() === "3");
check('"PGL Major Singapore 2026 Stage 1" -> [1]', stageNumbersFromTitle("PGL Major Singapore 2026 Stage 1").join() === "1");

console.log("\nstage-discovery - real Singapore captures");
const s1Page = parseHltvEventPage(s1Html);
check("Stage I page names itself (event 9303)", s1Page.eventId === 9303 && s1Page.title === "PGL Major Singapore 2026 Stage 1");
check("Stage I header span starts Nov 24", s1Page.dateStartMs !== null && new Date(s1Page.dateStartMs).toISOString().startsWith("2026-11-24"));
check("Stage I links Stage 2 (9304) and Stage 3 & Playoffs (8302)", (() => {
  const ids = s1Page.linked.map((l) => `${l.eventId}:${l.stages.join()}`).join(" ");
  return ids === "9304:2 8302:3";
})(), s1Page.linked.map((l) => `${l.eventId}:${l.title}`).join(" | "));
const links = linkStagesToSections(SG.sectionNames, s1Page.linked);
check("links map Stage II -> 9304 and Stage III -> hub 8302", links.get(112)?.eventId === 9304 && links.get(113)?.url === HUB_URL);
check("no link for the playoff sections", ![114, 115, 116].some((id) => links.has(id)));
const s1Bracket = parseSwissBracket(s1Html);
check("Stage I first published match is 2026-11-24T04:00Z (not the 11:00Z day marker)",
  firstPublishedMatchMs(s1Bracket) === Date.parse("2026-11-24T04:00:00Z"));
check("Stage I has published matchups", hasPublishedMatchups(s1Bracket));
const s1Facts = stageFactsFromPage(111, "https://www.hltv.org/events/9303/pgl-major-singapore-2026-stage-1", s1Page, s1Bracket);
check("Stage I facts: lock 04:00Z, window ends a day after the header end",
  s1Facts.firstMatchAt === "2026-11-24T04:00:00.000Z" &&
  s1Facts.windowEnd === new Date(s1Page.dateEndMs! + WINDOW_END_GRACE_MS).toISOString());
const s2Bracket = parseSwissBracket(s2Html);
check("Stage II (matchups not drawn yet): no published first match", firstPublishedMatchMs(s2Bracket) === null && !hasPublishedMatchups(s2Bracket));
const hubPage = parseHltvEventPage(hubHtml);
check("hub page: event 8302, Dec 2 - Dec 13 span", hubPage.eventId === 8302 &&
  new Date(hubPage.dateStartMs!).toISOString().startsWith("2026-12-02") &&
  new Date(hubPage.dateEndMs!).toISOString().startsWith("2026-12-13"));

console.log("\nstage-discovery - merge rules");
check("committed Singapore config is valid", validateEventRevealConfig(SG).length === 0);
check("committed Stage I lock is the published 04:00Z", SG.lockSchedule[111] === "2026-11-24T04:00:00Z");
check("no facts -> base returned unchanged", mergeStageFacts(SG, []) === SG);
const moved = mergeStageFacts(SG, [{ ...s1Facts, firstMatchAt: "2026-11-24T03:00:00.000Z" }]);
check("published first match replaces the committed lock", moved.lockSchedule[111] === "2026-11-24T03:00:00.000Z");
check("committed source and window are kept", moved.sectionSources[111] === SG.sectionSources[111] && moved.matchWindows[111] === SG.matchWindows[111]);
check("a fact with no first match changes nothing", mergeStageFacts(SG, [{ ...s1Facts, firstMatchAt: null }]) === SG);
check("a fact for a playoff section is ignored", mergeStageFacts(SG, [{ ...s1Facts, sectionId: 114 }]) === SG);
check("a fact for an unknown section is ignored", mergeStageFacts(SG, [{ ...s1Facts, sectionId: 999 }]) === SG);

console.log("\nstage-discovery - FAKE published Stage III wires itself");
// The real hub header + a timed Swiss bracket (Stage I's real cells, moved to
// Dec 2). This is what HLTV's hub looks like once Stage 3 is drawn.
const shift = Date.parse("2026-12-02T03:00:00Z") - Date.parse("2026-11-24T04:00:00Z");
const s1Region = s1Html.slice(s1Html.indexOf("<table"));
const fakeHub = hubHtml + s1Region.replace(/data-unix="(\d+)"/g, (_m, t) => `data-unix="${Number(t) + shift}"`);
const fakeFacts = stageFactsFromPage(113, HUB_URL, parseHltvEventPage(fakeHub), parseSwissBracket(fakeHub));
check("fake Stage III: first match 2026-12-02T03:00Z", fakeFacts.firstMatchAt === "2026-12-02T03:00:00.000Z", fakeFacts.firstMatchAt ?? "null");
const wired = mergeStageFacts(SG, [s1Facts, fakeFacts]);
check("Stage III gains the hub as its source", wired.sectionSources[113]?.url === HUB_URL);
check("Stage III gains its lock", wired.lockSchedule[113] === "2026-12-02T03:00:00.000Z");
check("Stage III gains a window ending after the hub's Dec 13 marker", !!wired.matchWindows[113] && Date.parse(wired.matchWindows[113].end) > Date.parse("2026-12-13T00:00:00Z"));
check("merged config passes every registry invariant", validateEventRevealConfig(wired).length === 0, validateEventRevealConfig(wired).join("; "));
check("Stage III reveals 24h before its lock", isBracketRevealed(113, Date.parse("2026-12-01T03:00:00Z"), wired.lockSchedule) &&
  !isBracketRevealed(113, Date.parse("2026-12-01T02:59:00Z"), wired.lockSchedule));
check("Stage III crawl window open on Dec 5", isWithinRefreshWindow(113, Date.parse("2026-12-05T12:00:00Z"), wired.lockSchedule, wired.matchWindows));

console.log("\nstage-discovery - unpublished stays dark");
const noTimes = hubHtml + s1Region.replace(/data-unix="\d+"/g, "");
const noTimesFacts = stageFactsFromPage(113, HUB_URL, parseHltvEventPage(noTimes), parseSwissBracket(noTimes));
check("matchups without times: no first match", noTimesFacts.firstMatchAt === null);
check("matchups without times: Stage III stays unsourced and undated", (() => {
  const m = mergeStageFacts(SG, [noTimesFacts]);
  return m === SG && !(113 in m.sectionSources) && lockTimeForSection(113, m.lockSchedule) === null;
})());
const tbd = hubHtml + s1Region.replace(/(class="swiss-visual-team-logo[^"]*"[^>]*\btitle=")[^"]*"/g, '$1?"');
check("TBD ('?') slots: no first match", firstPublishedMatchMs(parseSwissBracket(tbd)) === null);
check("'TBD' slots: no first match", firstPublishedMatchMs(parseSwissBracket(
  hubHtml + s1Region.replace(/(class="swiss-visual-team-logo[^"]*"[^>]*\btitle=")[^"]*"/g, '$1TBD"'),
)) === null);
check("header only (today's hub): no first match", stageFactsFromPage(113, HUB_URL, hubPage, parseSwissBracket(hubHtml)).firstMatchAt === null);
check("a discovered source with no window end is not added", mergeStageFacts(SG, [{ ...fakeFacts, windowEnd: null }]) === SG);

console.log("\nstage-discovery - the overlay reaches every registry read");
clearStageFacts();
check("before: EVENTS[27] is the committed config", EVENTS[27] === SG && getEventConfig(27) === SG);
check("setStageFacts reports a change", setStageFacts(27, [s1Facts, fakeFacts]) === true);
check("EVENTS[27] carries the discovered Stage III lock", EVENTS[27].lockSchedule[113] === "2026-12-02T03:00:00.000Z");
check("getEventConfig(27) carries the discovered Stage III source", getEventConfig(27)?.sectionSources[113]?.url === HUB_URL);
check("Object.values(EVENTS) sees the overlay", Object.values(EVENTS).some((e) => e.eventId === 27 && 113 in e.lockSchedule));
check("same facts again: no change, same object", (() => {
  const before = EVENTS[27];
  return setStageFacts(27, [fakeFacts, s1Facts]) === false && EVENTS[27] === before;
})());
check("home countdown follows the published Stage I start", stageOneStartFor(EVENTS[27]) === "2026-11-24T04:00:00.000Z");
check("Cologne untouched", EVENTS[26] === BASE_EVENTS[26]);
check("unknown event id ignored", setStageFacts(999, [fakeFacts]) === false);
check("empty facts revert to committed", setStageFacts(27, []) === true && EVENTS[27] === SG);
clearStageFacts();

console.log("\nstage-discovery - picks-page reveal rule");
const vis = (o: Partial<Parameters<typeof liveBracketVisible>[0]>) =>
  liveBracketVisible({ isSwiss: true, locked: false, revealedByClock: false, publishedMatchups: false, ...o });
check("Swiss, open, >24h out, nothing published: hidden", !vis({}));
check("Swiss, open, >24h out, matchups published: SHOWN (Stage I today)", vis({ publishedMatchups: true }));
check("Swiss, inside 24h window: shown", vis({ revealedByClock: true }));
check("Swiss, locked: shown (Cologne behaviour)", vis({ locked: true }));
check("playoff section: never", !vis({ isSwiss: false, publishedMatchups: true, locked: true }));
check("Stage I on 2026-11-22 with today's capture: shown", (() => {
  const now = Date.parse("2026-11-22T03:00:00Z");
  return vis({ revealedByClock: isBracketRevealed(111, now, SG.lockSchedule), publishedMatchups: hasPublishedMatchups(s1Bracket) }) &&
    !isBracketRevealed(111, now, SG.lockSchedule);
})());

console.log(`\nstage-discovery: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
