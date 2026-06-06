/**
 * verify-team-stats-live — offline proof for PHA-921 (live per-stage dossier).
 *
 * The dossier's "Last 5 matches" now refresh on their own, keyed to stage match
 * windows, mirroring PHA-902's live standings. The crawl/persist needs the deploy
 * network so it can't run in CI — but the PURE pieces that decide WHAT to crawl,
 * HOW to parse it, WHEN to refresh, and HOW to merge over the frozen snapshot all
 * run under plain node. This asserts those so a typo can't silently ship a dead
 * source map, a broken parser, an always-on (or never-on) refresh gate, or a
 * merge that blanks the frozen fallback.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/verify-team-stats-live.ts
 */

import {
  TEAM_SOURCES,
  teamStatsCrawlTargets,
  hltvProfileUrl,
  parseRecentResults,
  mergeLiveStats,
  accumulateRecentAcrossPasses,
  MAX_CRAWL_PASSES,
  MAX_TOTAL_CRAWL_MS,
  CRAWL_PASS_TIMEOUT_MS,
  type ParsedMatch,
} from "../src/lib/team-stats-sources.ts";
import {
  isWithinAnyMatchWindow,
  isWithinMatchWindow,
  COLOGNE_MATCH_WINDOWS,
} from "../src/lib/lock-schedule-core.ts";
import { TEAM_STATS, statsForPickid } from "../src/lib/team-stats-core.ts";

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

// ── Source map covers the field, and agrees with the committed snapshot ────────
const FIELD = [
  12, 48, 59, 60, 69, 74, 80, 81, 85, 87, 89, 95, 102, 104, 106, 112, 115, 119,
  122, 126, 127, 132, 134, 135, 137, 139, 140, 142, 145, 146, 147, 148,
];

check("TEAM_SOURCES covers exactly 32 teams", Object.keys(TEAM_SOURCES).length === 32);
for (const pid of FIELD) {
  const s = TEAM_SOURCES[pid];
  check(`source ${pid}: present`, s != null);
  if (!s) continue;
  check(`source ${pid}: hltvId positive int`, Number.isInteger(s.hltvId) && s.hltvId > 0);
  check(`source ${pid}: slug is url-safe`, /^[a-z0-9-]+$/.test(s.slug));
  check(`source ${pid}: name non-empty`, s.name.trim().length > 0);
  check(
    `source ${pid}: profile url is an HLTV team page`,
    /^https:\/\/www\.hltv\.org\/team\/\d+\/[a-z0-9-]+$/.test(hltvProfileUrl(s)),
  );
  // The live source must point at the SAME HLTV profile the frozen snapshot links
  // to — otherwise the live crawl would refresh a different team than the dossier
  // shows. (Both derive from the same gather tool, but assert it can't drift.)
  const frozen = statsForPickid(pid);
  check(`source ${pid}: url matches committed snapshot`, frozen?.hltvUrl === hltvProfileUrl(s));
}

const targets = teamStatsCrawlTargets();
check("crawl targets cover all 32 sources", targets.length === 32);
check(
  "crawl targets all carry a pickid + HLTV url",
  targets.every((t) => FIELD.includes(t.pickid) && t.url.startsWith("https://www.hltv.org/team/")),
);

// ── Recent-results parser ──────────────────────────────────────────────────────
const SAMPLE = `Some header text

Recent results

| 03/06/2026 | [Spirit](https://www.hltv.org/team/7020/spirit) 2 : 0 [MOUZ](https://www.hltv.org/team/4494/mouz) | [Match](https://www.hltv.org/matches/1/a) |
| 01/06/2026 | [Spirit](https://www.hltv.org/team/7020/spirit) 1 : 2 [FaZe](https://www.hltv.org/team/6667/faze) | [Match](https://www.hltv.org/matches/2/b) |
| 28/05/2026 | [Spirit](https://www.hltv.org/team/7020/spirit) 1 : 1 [G2](https://www.hltv.org/team/5995/g2) | [Match](https://www.hltv.org/matches/3/c) |
`;
const parsed = parseRecentResults(SAMPLE);
check("parser reads all 3 sample rows", parsed.length === 3);
check("parser: row 1 date", parsed[0]?.date === "03/06/2026");
check("parser: row 1 opponent is the post-score team", parsed[0]?.opponent === "MOUZ");
check("parser: row 1 score normalised a-b", parsed[0]?.score === "2-0");
check("parser: row 1 win derived from score", parsed[0]?.result === "W");
check("parser: row 2 loss derived from score", parsed[1]?.result === "L" && parsed[1]?.opponent === "FaZe");
check("parser: row 3 tie derived from equal score", parsed[2]?.result === "T" && parsed[2]?.score === "1-1");

// No "Recent results" header → empty (caller keeps frozen, never blanks).
check("parser: no section → []", parseRecentResults("nothing relevant here").length === 0);

// Caps at 5 even when more rows are present.
const manyRows = Array.from({ length: 8 }, (_, i) =>
  `| 0${(i % 9) + 1}/05/2026 | [A](https://www.hltv.org/team/1/a) 2 : 0 [B${i}](https://www.hltv.org/team/2/b) | [Match](https://www.hltv.org/m/${i}) |`,
).join("\n");
check("parser: caps at 5 most-recent", parseRecentResults(`Recent results\n${manyRows}`).length === 5);

// ── Merge over the frozen snapshot ─────────────────────────────────────────────
const frozenSpirit = TEAM_STATS[81];
const live = [
  { date: "09/06/2026", opponent: "Vitality", score: "2-1", result: "W" as const },
  { date: "08/06/2026", opponent: "FaZe", score: "0-2", result: "L" as const },
];
const merged = mergeLiveStats(frozenSpirit, live, TEAM_SOURCES[81]);
check("merge: recent[] replaced with live", merged.recent === live);
check("merge: roster kept frozen", merged.roster === frozenSpirit.roster);
check("merge: worldRank kept frozen", merged.worldRank === frozenSpirit.worldRank);
check("merge: hltvUrl preserved", merged.hltvUrl === frozenSpirit.hltvUrl);
// Empty / missing live → frozen returned unchanged (never blank a team).
check("merge: empty live → frozen ref", mergeLiveStats(frozenSpirit, [], TEAM_SOURCES[81]) === frozenSpirit);
check(
  "merge: undefined live → frozen ref",
  mergeLiveStats(frozenSpirit, undefined, TEAM_SOURCES[81]) === frozenSpirit,
);
// Back-fill hltvUrl when the frozen one is somehow blank.
const blankUrl = { ...frozenSpirit, hltvUrl: "" };
check(
  "merge: blank hltvUrl back-filled from source",
  mergeLiveStats(blankUrl, live, TEAM_SOURCES[81]).hltvUrl === hltvProfileUrl(TEAM_SOURCES[81]),
);

// ── Refresh-window gating ──────────────────────────────────────────────────────
const ms = (iso: string) => Date.parse(iso);
// Inside a stage window → refresh allowed.
check("window: inside Stage 1 (Jun 3) → any-window true", isWithinAnyMatchWindow(ms("2026-06-03T12:00:00Z")));
check("window: inside Stage 2 (Jun 7) → any-window true", isWithinAnyMatchWindow(ms("2026-06-07T12:00:00Z")));
check("window: inside Stage 3 (Jun 12) → any-window true", isWithinAnyMatchWindow(ms("2026-06-12T12:00:00Z")));
// Off-days → no refresh.
check("window: before the event (Jun 1) → any-window false", !isWithinAnyMatchWindow(ms("2026-06-01T12:00:00Z")));
check("window: between Stage 2 and Stage 3 (Jun 10) → any-window false", !isWithinAnyMatchWindow(ms("2026-06-10T12:00:00Z")));
check("window: after the event (Jun 16) → any-window false", !isWithinAnyMatchWindow(ms("2026-06-16T12:00:00Z")));
// any-window is exactly the OR of the per-section windows it folds.
{
  const t1 = ms("2026-06-07T12:00:00Z");
  const anySaysYes = Object.keys(COLOGNE_MATCH_WINDOWS).some((id) =>
    isWithinMatchWindow(Number(id), t1),
  );
  check("window: any === OR of per-section windows", isWithinAnyMatchWindow(t1) === anySaysYes);
}
// Empty window map → don't suppress (safe default for an undated future major).
check("window: empty windows → true (don't suppress)", isWithinAnyMatchWindow(ms("2030-01-01T00:00:00Z"), {}));
// A future major configured only via its own windows gates off the committed ones.
const futureWindows = { 200: { start: "2027-08-01T00:00:00Z", end: "2027-08-04T23:59:59Z" } };
check(
  "window: future-major config gates on its own windows (in)",
  isWithinAnyMatchWindow(ms("2027-08-02T12:00:00Z"), futureWindows),
);
check(
  "window: future-major config gates on its own windows (out)",
  !isWithinAnyMatchWindow(ms("2027-09-01T12:00:00Z"), futureWindows),
);

// ── Multi-pass crawl: retry + accumulate + partial-discard guard (PHA-944) ─────
// A parseable HLTV "Recent results" page for a fake team, so the injected crawl
// returns markdown the real parser turns into ≥1 match.
const teamMd = (opp: string) =>
  `Recent results\n| 03/06/2026 | [A](https://www.hltv.org/team/1/a) 2 : 0 [${opp}](https://www.hltv.org/team/2/b) | [Match](https://www.hltv.org/m/x) |`;

const allTargets = teamStatsCrawlTargets();

// (a) Happy path: pass 1 lands a partial set, pass 2 fills the rest. Accumulates.
{
  const calls: number[] = [];
  let n = 0;
  const crawl = async (
    targets: ReadonlyArray<{ pickid: number; url: string }>,
  ): Promise<Record<number, string>> => {
    calls.push(targets.length);
    n++;
    const out: Record<number, string> = {};
    // First pass covers all but the last 5; second pass covers the rest.
    const give = n === 1 ? targets.slice(0, targets.length - 5) : targets;
    for (const t of give) out[t.pickid] = teamMd(`opp${t.pickid}`);
    return out;
  };
  const fresh = await accumulateRecentAcrossPasses(allTargets, crawl, parseRecentResults);
  check("retry: two passes cover the full field", Object.keys(fresh).length === allTargets.length);
  check("retry: pass 2 only re-crawled the 5 missing", calls.length === 2 && calls[1] === 5);
}

// (b) THE FIX: pass 1 lands 27, pass 2 THROWS (transient crawl4ai 5xx). The 27
// must survive — before PHA-944 the throw unwound past the caller's persist and
// discarded them, blanking a good partial for ~1h.
{
  let n = 0;
  const crawl = async (
    targets: ReadonlyArray<{ pickid: number; url: string }>,
  ): Promise<Record<number, string>> => {
    n++;
    if (n >= 2) throw new Error("crawl4ai returned 502");
    const out: Record<number, string> = {};
    for (const t of targets.slice(0, 27)) out[t.pickid] = teamMd(`opp${t.pickid}`);
    return out;
  };
  let threw = false;
  let fresh: Record<number, ParsedMatch[]> = {};
  try {
    fresh = await accumulateRecentAcrossPasses(allTargets, crawl, parseRecentResults);
  } catch {
    threw = true;
  }
  check("partial-discard: a throwing later pass does NOT propagate", !threw);
  check("partial-discard: the 27 from pass 1 are retained", Object.keys(fresh).length === 27);
}

// (c) First pass throwing → empty result (caller keeps prior cache), never throws.
{
  const crawl = async (): Promise<Record<number, string>> => {
    throw new Error("crawl4ai unreachable");
  };
  const fresh = await accumulateRecentAcrossPasses(allTargets, crawl, parseRecentResults);
  check("partial-discard: pass-1 throw → empty, no propagation", Object.keys(fresh).length === 0);
}

// (d) Bounded passes: a field that's NEVER fully covered stops at MAX_CRAWL_PASSES
// (no infinite loop), and only ever re-crawls the still-missing teams.
{
  let n = 0;
  const crawl = async (
    targets: ReadonlyArray<{ pickid: number; url: string }>,
  ): Promise<Record<number, string>> => {
    n++;
    const out: Record<number, string> = {};
    // Each pass lands exactly one more team, so it can never reach full coverage.
    for (const t of targets.slice(0, 1)) out[t.pickid] = teamMd(`opp${t.pickid}`);
    return out;
  };
  const fresh = await accumulateRecentAcrossPasses(allTargets, crawl, parseRecentResults);
  check("bounded: stops after MAX_CRAWL_PASSES passes", n === MAX_CRAWL_PASSES);
  check("bounded: keeps the per-pass partials it did land", Object.keys(fresh).length === MAX_CRAWL_PASSES);
}

// (e) Total wall-clock budget: once MAX_TOTAL_CRAWL_MS is spent, no further pass
// runs even if teams remain — and the per-pass timeout is clamped to the budget.
{
  let n = 0;
  let lastTimeout = -1;
  // Injected clock: starts at 0, and the SECOND budget-check reads past the
  // deadline so pass 2 is skipped. Sequence of nowMs() reads:
  //   deadline = read#1; pass0 budget = read#2; pass1 budget = read#3 (> deadline).
  const reads = [0, 0, MAX_TOTAL_CRAWL_MS + 1];
  let r = 0;
  const clock = () => reads[Math.min(r++, reads.length - 1)];
  const crawl = async (
    targets: ReadonlyArray<{ pickid: number; url: string }>,
    timeoutMs: number,
  ): Promise<Record<number, string>> => {
    n++;
    lastTimeout = timeoutMs;
    const out: Record<number, string> = {};
    for (const t of targets.slice(0, 1)) out[t.pickid] = teamMd(`opp${t.pickid}`);
    return out;
  };
  const fresh = await accumulateRecentAcrossPasses(allTargets, crawl, parseRecentResults, clock);
  check("budget: only one pass ran before the budget was spent", n === 1);
  check("budget: pass-1 partial still retained", Object.keys(fresh).length === 1);
  check(
    "budget: per-pass timeout clamped to remaining budget",
    lastTimeout === Math.min(CRAWL_PASS_TIMEOUT_MS, MAX_TOTAL_CRAWL_MS),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
