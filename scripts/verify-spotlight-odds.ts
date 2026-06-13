/**
 * verify-spotlight-odds - offline proof for PHA-1066 (live Spotlight market odds).
 *
 * The live line is fetched from Polymarket's gamma-api, but every decision that
 * could show a WRONG number is pure and proven here, with no network:
 *   - parsing gamma's JSON-encoded `outcomes`/`outcomePrices` (string arrays),
 *   - orienting the two-way market to "this team" by name (never guessing a side),
 *   - the "updated N ago" label bucketing against the ~1h refresh floor,
 *   - assembling the modal-ready SpotlightMarketLine.
 * Also asserts the GATED invariant: PLAYOFF_MARKET_SLUGS ships EMPTY until Valve
 * seeds the bracket, so the feature is inert (modal "coming soon") until authored.
 *
 * Run: node scripts/verify-spotlight-odds.ts
 */

import {
  PLAYOFF_MARKET_SLUGS,
  gammaEventUrl,
  parseMarketOutcomes,
  resolveMatchupOdds,
  formatUpdatedLabel,
  buildMarketLine,
  ODDS_SOURCE_LABEL,
  type GammaEvent,
} from "../src/lib/spotlight-odds-core.ts";

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
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

console.log("\nspotlight-odds - gated registry invariant (PHA-1066/993)");
check(
  "PLAYOFF_MARKET_SLUGS ships EMPTY (no matchup authored before Valve seeds)",
  Object.keys(PLAYOFF_MARKET_SLUGS).length === 0,
);
check(
  "gammaEventUrl encodes the slug into the events query",
  gammaEventUrl("furia-vs-the-mongolz") ===
    "https://gamma-api.polymarket.com/events?slug=furia-vs-the-mongolz",
);
check("gammaEventUrl url-encodes unsafe slug chars", gammaEventUrl("a b&c").includes("a%20b%26c"));

console.log("\nspotlight-odds - parseMarketOutcomes (gamma's JSON-string arrays)");
check(
  "well-formed string arrays parse to typed outcomes + prices",
  (() => {
    const p = parseMarketOutcomes({ outcomes: '["FURIA","The MongolZ"]', outcomePrices: '["0.62","0.38"]' });
    return !!p && p.outcomes[0] === "FURIA" && near(p.prices[0], 0.62) && near(p.prices[1], 0.38);
  })(),
);
check(
  "defensively accepts real arrays (not just JSON strings)",
  (() => {
    const p = parseMarketOutcomes({
      outcomes: ["A", "B"] as unknown as string,
      outcomePrices: ["0.5", "0.5"] as unknown as string,
    });
    return !!p && p.outcomes.length === 2;
  })(),
);
check("undefined market → null", parseMarketOutcomes(undefined) === null);
check("malformed JSON → null", parseMarketOutcomes({ outcomes: "[oops", outcomePrices: "[0.5]" }) === null);
check(
  "mismatched lengths → null",
  parseMarketOutcomes({ outcomes: '["A","B"]', outcomePrices: '["0.5"]' }) === null,
);
check(
  "fewer than 2 outcomes → null",
  parseMarketOutcomes({ outcomes: '["A"]', outcomePrices: '["1.0"]' }) === null,
);
check(
  "non-numeric price → null",
  parseMarketOutcomes({ outcomes: '["A","B"]', outcomePrices: '["x","0.5"]' }) === null,
);
check(
  "out-of-range price (>1) → null",
  parseMarketOutcomes({ outcomes: '["A","B"]', outcomePrices: '["1.2","-0.2"]' }) === null,
);

console.log("\nspotlight-odds - resolveMatchupOdds (orient to this team, never guess)");
const matchEvent: GammaEvent = {
  slug: "furia-vs-the-mongolz",
  markets: [{ outcomes: '["FURIA","The MongolZ"]', outcomePrices: '["0.62","0.38"]' }],
};
check(
  "team at index 0 → its pct + opp derived",
  (() => {
    const r = resolveMatchupOdds(matchEvent, "FURIA");
    return !!r && near(r.teamPct, 62) && r.oppName === "The MongolZ" && near(r.oppPct, 38);
  })(),
);
check(
  "team at index 1 → orientation flips correctly",
  (() => {
    const r = resolveMatchupOdds(matchEvent, "The MongolZ");
    return !!r && near(r.teamPct, 38) && r.oppName === "FURIA" && near(r.oppPct, 62);
  })(),
);
check(
  "alias substring match (Natus Vincere ↔ NAVI)",
  (() => {
    const ev: GammaEvent = {
      markets: [{ outcomes: '["NAVI","Vitality"]', outcomePrices: '["0.55","0.45"]' }],
    };
    const r = resolveMatchupOdds(ev, "Natus Vincere (NAVI)");
    return !!r && near(r.teamPct, 55) && r.oppName === "Vitality";
  })(),
);
check(
  "unmatched team name → null (don't show a team its opponent's odds)",
  resolveMatchupOdds(matchEvent, "Astralis") === null,
);
check("event with no markets → null", resolveMatchupOdds({ markets: [] }, "FURIA") === null);
check("undefined event → null", resolveMatchupOdds(undefined, "FURIA") === null);
check(
  "skips a 3-way market, resolves the binary one naming the team",
  (() => {
    const ev: GammaEvent = {
      markets: [
        { outcomes: '["A","B","C"]', outcomePrices: '["0.4","0.3","0.3"]' },
        { outcomes: '["FURIA","Spirit"]', outcomePrices: '["0.7","0.3"]' },
      ],
    };
    const r = resolveMatchupOdds(ev, "FURIA");
    return !!r && near(r.teamPct, 70) && r.oppName === "Spirit";
  })(),
);

console.log("\nspotlight-odds - formatUpdatedLabel (honest against the ~1h floor)");
const T = 1_700_000_000_000;
check("<1 min → 'just now'", formatUpdatedLabel(T, T + 30_000) === "just now");
check("12 min → '12m ago'", formatUpdatedLabel(T, T + 12 * 60_000) === "12m ago");
check("just over 1h → '1h ago'", formatUpdatedLabel(T, T + 75 * 60_000) === "1h ago");
check("3h → '3h ago'", formatUpdatedLabel(T, T + 3 * 3_600_000) === "3h ago");
check("negative delta clamps to 'just now'", formatUpdatedLabel(T, T - 5_000) === "just now");

console.log("\nspotlight-odds - buildMarketLine (modal-ready shape)");
check(
  "assembles a complete line with source label + passthrough hltv url",
  (() => {
    const line = buildMarketLine({
      teamName: "FURIA",
      parsed: { teamPct: 62, oppName: "The MongolZ", oppPct: 38 },
      fetchedAtMs: T,
      nowMs: T + 12 * 60_000,
      hltvMatchUrl: "https://www.hltv.org/matches/123/x",
    });
    return (
      line.teamName === "FURIA" &&
      near(line.teamPct, 62) &&
      line.oppName === "The MongolZ" &&
      near(line.oppPct, 38) &&
      line.sourceLabel === ODDS_SOURCE_LABEL &&
      line.updatedLabel === "12m ago" &&
      line.hltvMatchUrl === "https://www.hltv.org/matches/123/x"
    );
  })(),
);

console.log(`\nspotlight-odds: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
