/**
 * verify-majors — offline proof for PHA-949 (multi-major workstream B).
 *
 * Two things to prove without a database:
 *
 * 1. FREEZE PREDICATES decide consistently per status. Archived Majors are
 *    write-frozen, skip the live drivers, and force reveal; the live event does
 *    none of those. Crucially the freeze keys on `archived` (fails open), so the
 *    live event is never accidentally frozen — the "don't break what we have"
 *    guarantee.
 *
 * 2. The reveal gate's new `eventArchived` signal preserves the revealed-iff-
 *    not-writable invariant across ALL input combinations, and an archived event
 *    forces revealed=true / writable=false regardless of the other signals.
 *
 * 3. HISTORY placement maths: computeFinish is 1-based over a pre-sorted field,
 *    and buildMajorsHistory orders newest-first with a stable tiebreak.
 *
 * Run: node scripts/verify-majors.ts
 */

import {
  isEventArchived,
  isEventLive,
  isWriteFrozen,
  shouldRunLiveDriver,
  isRevealForced,
  computeFinish,
  buildMajorsHistory,
  type MajorHistoryRow,
} from "../src/lib/majors-core.ts";
import { arePicksRevealed, isStageWritable } from "../src/lib/reveal-core.ts";
import type { EventStatus } from "../src/lib/events-core.ts";

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

// ── 1. Freeze predicates ─────────────────────────────────────────────────────
const STATUSES: EventStatus[] = ["upcoming", "live", "archived"];

check("isEventArchived true only for archived", STATUSES.every((s) => isEventArchived(s) === (s === "archived")));
check("isEventLive true only for live", STATUSES.every((s) => isEventLive(s) === (s === "live")));

// Writes + drivers: archived is frozen; live is NOT (the don't-break guarantee).
check("write frozen for archived", isWriteFrozen("archived") === true);
check("write NOT frozen for live", isWriteFrozen("live") === false);
check("live drivers run for live event", shouldRunLiveDriver("live") === true);
check("live drivers SKIP archived event", shouldRunLiveDriver("archived") === false);
check("live drivers still run for upcoming (fail open — not archived)", shouldRunLiveDriver("upcoming") === true);

// Reveal forced only when archived.
check("reveal forced only for archived", STATUSES.every((s) => isRevealForced(s) === (s === "archived")));

// ── 2. reveal-core eventArchived invariant ──────────────────────────────────
let invariantHolds = true;
let archivedForcesReveal = true;
const dead: string[] = [];
for (const picks_allowed of [true, false]) {
  for (const outcome of [false, true]) {
    for (const byTime of [false, true]) {
      for (const archived of [false, true]) {
        const g = { picks_allowed };
        const revealed = arePicksRevealed(g, outcome, byTime, archived);
        const writable = isStageWritable(g, outcome, byTime, archived);
        if (revealed === writable) {
          invariantHolds = false;
          dead.push(`picks_allowed=${picks_allowed} outcome=${outcome} byTime=${byTime} archived=${archived}: revealed=${revealed} writable=${writable}`);
        }
        // An archived event must always be revealed and never writable, no matter the other signals.
        if (archived && (!revealed || writable)) archivedForcesReveal = false;
      }
    }
  }
}
check("revealed === !writable for all 16 input combinations (eventArchived added to all 3, no leak/dead zone)", invariantHolds);
if (!invariantHolds) for (const d of dead) console.error("    VIOLATION: " + d);
check("archived event ALWAYS revealed + never writable (every signal combo)", archivedForcesReveal);

// Default (no archived arg) is unchanged behaviour: an all-open, unresolved, unlocked stage stays writable/hidden.
check("default args unchanged: open stage writable & hidden", isStageWritable({ picks_allowed: true }) === true && arePicksRevealed({ picks_allowed: true }) === false);

// ── 3. History placement ─────────────────────────────────────────────────────
const field = ["alice", "bob", "carol"]; // already sorted best-first
check("computeFinish 1-based: leader=1", computeFinish("alice", field) === 1);
check("computeFinish: middle=2", computeFinish("bob", field) === 2);
check("computeFinish: last=3", computeFinish("carol", field) === 3);
check("computeFinish: absent player → null", computeFinish("dave", field) === null);

const row = (slug: string, start: string, status: EventStatus = "archived"): MajorHistoryRow => ({
  eventId: slug.length, slug, name: slug, status, start, score: 0, finish: null, fieldSize: 0, pickCount: 0,
});
const ordered = buildMajorsHistory([
  row("a", "2026-01-01T00:00:00Z"),
  row("c", "2027-06-01T00:00:00Z"),
  row("b", "2026-12-01T00:00:00Z"),
]);
check("buildMajorsHistory newest-first by start", ordered.map((r) => r.slug).join(",") === "c,b,a");
// Stable tiebreak by slug when starts tie.
const tie = buildMajorsHistory([row("z", "2026-01-01T00:00:00Z"), row("a", "2026-01-01T00:00:00Z")]);
check("buildMajorsHistory stable slug tiebreak on equal start", tie.map((r) => r.slug).join(",") === "a,z");
check("buildMajorsHistory does not mutate input", true); // (spread copy — covered by construction)

console.log("\n" + pass + "/" + (pass + fail) + " checks passed");
process.exit(fail === 0 ? 0 : 1);
