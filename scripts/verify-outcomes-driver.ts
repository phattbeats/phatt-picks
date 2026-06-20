/**
 * verify-outcomes-driver - offline proof for PHA-866 (live outcomes/scoring driver).
 *
 * The leaderboard/reveal would sit frozen mid-event because nothing triggered the
 * owner-gated ingest route on a cadence. The fix mirrors the news wire's read-path
 * refresh (PHA-863, refreshWireOnRead): the live read surfaces call
 * refreshOutcomesOnRead, which atomically claims a 30s refresh slot and DEFERS the
 * slow ingest past the response via Next's `after`, so results land as matches
 * finish with no external cron and no added render latency. This is a
 * static-source check (no DB needed): it asserts the helper exists, uses the
 * atomic claim + deferred pattern, bounds the source fetch, and is wired into every
 * surface that reads resolved outcomes. Gating/idempotency is proven separately by
 * verify-outcomes-gate.
 *
 * Run: node scripts/verify-outcomes-driver.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

console.log("\noutcomes-driver - canonical claim + deferred pattern (mirrors PHA-863)");

const outcomes = read("src/lib/outcomes.ts");
// The claim + deferred-run primitives are shared across every on-read driver
// (PHA-1271 lean pass), so the canonical-pattern assertions read both the
// outcomes call sites AND the shared lib/source-refresh.ts that owns them.
const sourceRefresh = read("src/lib/source-refresh.ts");
check(
  "outcomes.ts exports refreshOutcomesOnRead",
  /export async function refreshOutcomesOnRead\(/.test(outcomes),
);
check(
  "refresh is gated by an ATOMIC claim (updateMany guarded by the floor)",
  // outcomes binds the outcomes source to the shared claim; the shared claim is
  // the atomic compare-and-set (updateMany where lastCallAt < floor). PHA-1271.
  /claimOutcomesRefreshSlot[\s\S]*?claimRefreshSlot\(\s*OUTCOMES_REFRESH_SOURCE/.test(outcomes) &&
    /sourceState\.updateMany\(\s*\{\s*where:\s*\{\s*source,\s*lastCallAt:\s*\{\s*lt:\s*floor/.test(
      sourceRefresh,
    ),
);
check(
  "losing the claim is a no-op (no double-fire across renders/processes)",
  /if \(!\(await claimOutcomesRefreshSlot\(\)\)\) return/.test(outcomes),
);
check(
  "slow ingest + HLTV bridge are DEFERRED past the response via Next `after`",
  // PHA-918: the deferred body runs the answer-key ingest AND the HLTV Swiss
  // bridge that resolves the buckets Valve leaves ambiguous. PHA-1271: the
  // deferral primitive (Next `after`) now lives in the shared source-refresh lib.
  /runDeferred\(async \(\) => \{[\s\S]*?ingestOutcomes\(eventId\)[\s\S]*?bridgeSwissOutcomes\(eventId\)/.test(outcomes) &&
    /import \{ after \} from "next\/server"/.test(sourceRefresh) &&
    /after\(run\)/.test(sourceRefresh),
);
check(
  "deferred task swallows errors — .catch inside runDeferred's run closure",
  // Pin the .catch to the shared runDeferred body, not any arbitrary downstream .catch.
  /function runDeferred[\s\S]{0,400}\.catch\(/.test(sourceRefresh),
);
check(
  "claim is best-effort (outer catch grants slot on any DB error)",
  // Within-floor / lost-race returns `inserted > 0` (0 = backed off).
  // Outer catch returns true (DB hiccup — allow rather than block forever).
  // PHA-1271: the compare-and-set body lives in the shared claimRefreshSlot.
  /export async function claimRefreshSlot[\s\S]*?return inserted > 0;[\s\S]*?} catch \{[\s\S]{0,80}return true;/.test(sourceRefresh),
);

console.log("\noutcomes-driver - source fetch is bounded (can't hang the deferred run)");

const liquipedia = read("src/lib/liquipedia.ts");
check(
  "liquipedia parse fetch carries an AbortSignal.timeout",
  /AbortSignal\.timeout\(PARSE_FETCH_TIMEOUT_MS\)/.test(liquipedia) &&
    /const PARSE_FETCH_TIMEOUT_MS = /.test(liquipedia),
);

console.log("\noutcomes-driver - in-process live tick drives the Valve oracle (PHA-1273)");

check(
  "refreshLiveResultsTick runs the Valve oracle (ingestOutcomes) so playoffs resolve headlessly",
  // PHA-1273: playoff StageOutcome rows come only from the Valve answer key
  // (ingestOutcomes), which previously ran solely on the owner trigger / the
  // unreliable after()-deferred read path. The traffic-independent tick must call
  // it so QF/SF/GF turn green within a tick like Swiss clinches do.
  /export async function refreshLiveResultsTick\([\s\S]*?await ingestOutcomes\(eventId\)[\s\S]*?bridgeSwissOutcomes\(eventId, nowMs\)/.test(
    outcomes,
  ),
);

console.log("\noutcomes-driver - wired into every outcome-reading surface");

for (const [label, path] of [
  ["dashboard", "src/app/(app)/page.tsx"],
  ["leaderboard", "src/app/(app)/leaderboard/page.tsx"],
  ["reveal", "src/app/(app)/reveal/[section]/page.tsx"],
  ["players", "src/app/(app)/players/page.tsx"],
  ["player-detail", "src/app/(app)/players/[id]/page.tsx"],
  ["compare", "src/app/(app)/leaderboard/compare/page.tsx"],
] as const) {
  const src = read(path);
  check(
    `${label} imports refreshOutcomesOnRead`,
    /import\s*\{[^}]*\brefreshOutcomesOnRead\b[^}]*\}\s*from\s*["']@\/lib\/outcomes["']/.test(src),
  );
  check(
    `${label} awaits refreshOutcomesOnRead(EVENT_ID)`,
    /await refreshOutcomesOnRead\(EVENT_ID\)/.test(src),
  );
}

console.log("\n" + pass + "/" + (pass + fail) + " checks passed");
process.exit(fail === 0 ? 0 : 1);
