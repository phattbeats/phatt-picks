/**
 * Spotlight live market odds — pure core (PHA-1066, child of PHA-1043).
 *
 * The playoff Spotlight modal has a market slot that, until now, shows a "coming
 * soon" state. This module is the verifiable half of wiring the live line: it
 * parses Polymarket's public gamma-api into a {@link SpotlightMarketLine} the
 * modal already renders. No I/O lives here (the cached fetch is in
 * `spotlight-odds.ts`), so the whole parse + name-match + label path is provable
 * offline by `scripts/verify-spotlight-odds.ts`.
 *
 * SOURCE (verified PHA-1043): gamma-api.polymarket.com/events?slug=<matchup-slug>
 * returns the event with its `markets[]`. A head-to-head match is one market
 * whose `outcomes` and `outcomePrices` are JSON-ENCODED STRING arrays, e.g.
 * outcomes `["FURIA","The MongolZ"]`, outcomePrices `["0.62","0.38"]`. The price
 * is the implied win probability (0..1). No auth, ~160ms.
 *
 * GATED BY DESIGN: {@link PLAYOFF_MARKET_SLUGS} is LEFT EMPTY until Valve seeds
 * the playoff bracket (~Jun 16 2026, PHA-993). A team has no opponent — and so no
 * matchup slug to target — before then, so an empty registry means the refresh
 * no-ops and the modal keeps its honest "coming soon" state (zero live change).
 * An editor fills one entry per seeded matchup at clinch time (alongside PHA-1065
 * Spotlight authoring), verifying the rendered line against the live response.
 */

/** A live market line for the team's next/active playoff matchup (1h refresh). */
export interface SpotlightMarketLine {
  /** This team's name (echoed for clarity). */
  teamName: string;
  /** This team's implied win probability, 0-100. */
  teamPct: number;
  /** The opponent's display name, or "TBD". */
  oppName: string;
  /** Opponent implied win probability, 0-100. */
  oppPct: number;
  /** Where the line came from, e.g. "Polymarket implied odds". */
  sourceLabel: string;
  /** When it was last refreshed (already-formatted, e.g. "1h ago"). */
  updatedLabel: string;
  /** Deep link to the HLTV match page for people who want to dive in. */
  hltvMatchUrl?: string;
}

/**
 * One authored matchup target, keyed by layout pickid in {@link PLAYOFF_MARKET_SLUGS}.
 * Both teams in a match point at the SAME `slug`; each carries its own `teamName`
 * so the parser knows which of the two gamma outcomes is "this team" (the other
 * becomes the opponent). `teamName` is the name as it appears in the Polymarket
 * outcomes — the editor verifies it against the live response when authoring.
 */
export interface MatchupMarketTarget {
  /** Polymarket event slug, e.g. "furia-vs-the-mongolz-2026-06-17". */
  slug: string;
  /** Display name to match within the event's outcomes (this team's side). */
  teamName: string;
  /** Optional HLTV match page deep link shown under the bar. */
  hltvMatchUrl?: string;
}

/**
 * GATED CONFIG — intentionally EMPTY until Valve seeds the playoff bracket
 * (~Jun 16 2026, PHA-993). Keyed by layout pickid. Empty ⇒ no fetch, no cache
 * write, modal stays "coming soon" (no live change). Fill one entry per side per
 * seeded matchup, e.g.:
 *
 *   85: { slug: "furia-vs-the-mongolz-...", teamName: "FURIA",
 *         hltvMatchUrl: "https://www.hltv.org/matches/..." },
 *   12: { slug: "furia-vs-the-mongolz-...", teamName: "The MongolZ", ... },
 *
 * (the two pickids share the slug; teamName distinguishes the side).
 */
export const PLAYOFF_MARKET_SLUGS: Record<number, MatchupMarketTarget> = {};

export const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
/** No auth, single small JSON — a tight timeout is plenty (~160ms measured). */
export const ODDS_FETCH_TIMEOUT_MS = 8_000;
/** ~Hourly refresh floor — implied odds drift slowly between maps. */
export const ODDS_REFRESH_MIN_INTERVAL_MS = 60 * 60_000;
/** Provenance shown under the bar. */
export const ODDS_SOURCE_LABEL = "Polymarket implied odds";

/** Build the gamma-api events URL for a single matchup slug. */
export function gammaEventUrl(slug: string): string {
  return `${GAMMA_API_BASE}/events?slug=${encodeURIComponent(slug)}`;
}

/** Minimal shape of a gamma market we read (other fields ignored). */
export interface GammaMarket {
  /** JSON-encoded string array of outcome names, e.g. '["FURIA","NAVI"]'. */
  outcomes?: string;
  /** JSON-encoded string array of prices (implied prob 0..1), e.g. '["0.62","0.38"]'. */
  outcomePrices?: string;
  /**
   * Polymarket's classifier for a sports/esports sub-market. A single H2H event
   * carries MANY two-outcome markets — moneyline, map/set handicaps, totals,
   * round/kill props — and several non-moneyline ones ALSO use the two team
   * names as outcomes (e.g. "Set Handicap: A vs B", "map_handicap"). The MATCH
   * win % is the `"moneyline"` market specifically; we must select it by type,
   * not by "first market that names the team" (verified live, PHA-1066 review).
   */
  sportsMarketType?: string;
}

/** Polymarket's market type for the straight match-winner line (the win %). */
export const MONEYLINE_MARKET_TYPE = "moneyline";

/** Minimal shape of a gamma event (the /events?slug= response is an array of these). */
export interface GammaEvent {
  slug?: string;
  markets?: GammaMarket[];
}

/** A market's parsed two-way outcome/price pair (only well-formed binary markets). */
interface ParsedMarket {
  outcomes: string[];
  prices: number[];
}

/**
 * Parse a market's JSON-encoded `outcomes` / `outcomePrices` into typed arrays.
 * Returns null unless BOTH parse to arrays of equal length ≥ 2 with numeric,
 * in-range (0..1) prices. Robust to gamma sending real arrays instead of strings
 * (defensive — the documented shape is strings).
 */
export function parseMarketOutcomes(market: GammaMarket | undefined): ParsedMarket | null {
  if (!market) return null;
  const outcomes = coerceStringArray(market.outcomes);
  const rawPrices = coerceStringArray(market.outcomePrices);
  if (!outcomes || !rawPrices) return null;
  if (outcomes.length < 2 || outcomes.length !== rawPrices.length) return null;
  const prices = rawPrices.map((p) => Number(p));
  if (prices.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) return null;
  return { outcomes, prices };
}

function coerceStringArray(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v !== "string") return null;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : null;
  } catch {
    return null;
  }
}

/** Normalize a team name for tolerant matching (case/punctuation/spacing-insensitive). */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The resolved two-way odds for one matchup, oriented to "this team". */
export interface ParsedMatchupOdds {
  teamPct: number;
  oppName: string;
  oppPct: number;
}

/** Orient a single parsed two-way market to `wanted` (normalized name). null = no match. */
function orientMarket(parsed: ParsedMarket, wanted: string): ParsedMatchupOdds | null {
  if (parsed.outcomes.length !== 2) return null;
  const norm = parsed.outcomes.map(normalizeName);
  let idx = norm.findIndex((n) => n === wanted);
  if (idx === -1) {
    idx = norm.findIndex((n) => n.includes(wanted) || wanted.includes(n));
  }
  if (idx === -1) return null;
  const oppIdx = idx === 0 ? 1 : 0;
  return {
    teamPct: parsed.prices[idx] * 100,
    oppName: parsed.outcomes[oppIdx],
    oppPct: parsed.prices[oppIdx] * 100,
  };
}

/**
 * Resolve a matchup event into this team's implied win % and the opponent's,
 * oriented by name-matching `teamName`. Returns null when no usable market exists
 * OR `teamName` can't be matched — we never GUESS which outcome is "this team" (a
 * wrong orientation would show a team its opponent's odds).
 *
 * CRITICAL (PHA-1066 review, verified against live gamma events): a single H2H
 * event carries MANY two-outcome markets, and several non-moneyline ones (set/map
 * handicaps, "Set 1 Winner", child moneylines) ALSO use the two TEAM NAMES as
 * outcomes. The MATCH win % is the `"moneyline"` market specifically. So:
 *   1. If a `moneyline` market exists, resolve ONLY against it — a name mismatch
 *      there returns null rather than falling through to a handicap line (which
 *      would surface, say, a map-handicap price as the "win %").
 *   2. Only when NO moneyline market exists do we fall back to the first
 *      two-outcome market that names the team (a non-sports binary event).
 * Exact normalized match first, then substring either direction (handles
 * "Natus Vincere" vs "NAVI" aliases).
 */
export function resolveMatchupOdds(
  event: GammaEvent | null | undefined,
  teamName: string,
): ParsedMatchupOdds | null {
  const markets = event?.markets;
  if (!Array.isArray(markets)) return null;
  const wanted = normalizeName(teamName);
  if (!wanted) return null;

  // Prefer the moneyline (straight match-winner) market — the actual win %.
  for (const market of markets) {
    if (market.sportsMarketType !== MONEYLINE_MARKET_TYPE) continue;
    const parsed = parseMarketOutcomes(market);
    if (parsed?.outcomes.length === 2) {
      return orientMarket(parsed, wanted); // null if name mismatch — don't fall through
    }
  }

  // No moneyline (e.g. a plain binary non-sports event): first 2-outcome match.
  for (const market of markets) {
    const parsed = parseMarketOutcomes(market);
    if (!parsed) continue;
    const oriented = orientMarket(parsed, wanted);
    if (oriented) return oriented;
  }
  return null;
}

/**
 * Human "updated N ago" label from a fetch timestamp. Buckets to the granularity
 * the line actually moves at (≤1m → "just now", minutes, then hours), so the
 * footer reads honestly against the ~1h refresh floor.
 */
export function formatUpdatedLabel(fetchedAtMs: number, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - fetchedAtMs);
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

/**
 * Assemble the modal-ready {@link SpotlightMarketLine} from resolved odds plus
 * presentation context. Pure — the caller supplies `fetchedAtMs`/`nowMs` so the
 * "updated" label is deterministic and testable.
 */
export function buildMarketLine(args: {
  teamName: string;
  parsed: ParsedMatchupOdds;
  fetchedAtMs: number;
  nowMs: number;
  hltvMatchUrl?: string;
}): SpotlightMarketLine {
  const { teamName, parsed, fetchedAtMs, nowMs, hltvMatchUrl } = args;
  return {
    teamName,
    teamPct: parsed.teamPct,
    oppName: parsed.oppName,
    oppPct: parsed.oppPct,
    sourceLabel: ODDS_SOURCE_LABEL,
    updatedLabel: formatUpdatedLabel(fetchedAtMs, nowMs),
    hltvMatchUrl,
  };
}
