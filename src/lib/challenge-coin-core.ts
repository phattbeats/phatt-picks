/**
 * Challenge coins (PHA-1278) — a Major-themed COLLECTIBLE track, separate from
 * the Viewer Pass coin (coin-core / .coin-sticker, which mirrors a player's
 * Valve coin). Brandon: "challenge coins based on the logo of each major" — one
 * coin per Major a player took part in, so they build a shelf over time.
 *
 * EARN RULE (confirmed with Brandon on the issue): a coin mints when the player
 * PARTICIPATED (made ≥1 real pick that Major) AND the Major has CONCLUDED
 * (effectively archived — its Grand Final resolved, per event-freeze). No new
 * earning backend: every input here is derived from existing picks/outcomes,
 * exactly like the /majors history view.
 *
 * TIERS (confirmed: "both as tiers"). The two struck finishes are the two tiers:
 *   • GOLD  — a top-fraction finish among the field (and always for the winner).
 *   • STEEL — everyone else who took part.
 * So showing up earns the steel coin; finishing near the top upgrades it to gold.
 *
 * Pure module — no `@/` alias, no prisma, no fetch, no JSON import — so the
 * verify harness (scripts/verify-challenge-coin.ts) imports it directly under
 * `node --experimental-strip-types`. The I/O that assembles its inputs from the
 * database lives in the server module challenge-coins.ts.
 */

export type CoinTier = "steel" | "gold";

/**
 * The top fraction of the field that earns the GOLD finish; everyone else who
 * took part gets STEEL. 0.25 = top quartile. Single knob — change here to retune
 * how hard gold is to earn (the verify harness pins the maths, not the value).
 */
export const GOLD_TOP_FRACTION = 0.25;

/** Everything needed to decide one player's coin for one Major. Pure shape. */
export interface CoinInput {
  eventId: number;
  /** Stable url-safe handle (e.g. "iem-cologne-2026") — keys the art asset. */
  slug: string;
  /** Human display name of the Major. */
  name: string;
  /** Has the Major concluded (effectively archived)? Coins only mint then. */
  archived: boolean;
  /** Did the player make ≥1 real (non-cleared) pick that Major? */
  participated: boolean;
  /** Whether the layout scored — a real finish vs an unavailable one. */
  scored: boolean;
  /** 1-based finish among the field, or null if unscored. */
  finish: number | null;
  /** How many players took part. */
  fieldSize: number;
}

/** A coin the player owns, ready to render on the shelf. */
export interface ChallengeCoin {
  eventId: number;
  slug: string;
  name: string;
  tier: CoinTier;
  /** 1-based finish among the field, or null if unscored. */
  finish: number | null;
  fieldSize: number;
}

/** A coin mints when the player took part AND the Major has concluded. */
export function isCoinEarned(i: { participated: boolean; archived: boolean }): boolean {
  return i.participated && i.archived;
}

/**
 * GOLD for a top-fraction finish (always for the outright winner), STEEL
 * otherwise. An unscored / unknown finish falls back to STEEL — you still earn
 * the coin for taking part, just not the gold tier. `frac` is injectable so the
 * verify harness can pin the cutoff maths independent of the shipped value.
 */
export function coinTierForFinish(
  finish: number | null,
  fieldSize: number,
  frac: number = GOLD_TOP_FRACTION,
): CoinTier {
  if (finish === null || finish < 1 || fieldSize < 1) return "steel";
  if (finish === 1) return "gold";
  const cutoff = Math.max(1, Math.ceil(fieldSize * frac));
  return finish <= cutoff ? "gold" : "steel";
}

/**
 * Pre-rendered coin art path for a Major + tier. The renders are generated
 * assets dropped under /public/coins (PHA-1278), so re-skinning a Major is a
 * one-shot asset swap — no code change. Future Majors just need their two PNGs
 * at this path; a missing asset degrades to the <Image> alt, never a crash.
 */
export function coinArtSrc(slug: string, tier: CoinTier): string {
  return `/coins/${slug}-${tier}.png`;
}

/**
 * Derive the minted coins from a player's per-Major rows (already scored by the
 * caller, exactly as /majors does). Only earned coins come back; tier is decided
 * per Major. Order is preserved — the caller sorts (newest Major first).
 */
export function deriveChallengeCoins(inputs: readonly CoinInput[]): ChallengeCoin[] {
  const coins: ChallengeCoin[] = [];
  for (const i of inputs) {
    if (!isCoinEarned(i)) continue;
    coins.push({
      eventId: i.eventId,
      slug: i.slug,
      name: i.name,
      tier: i.scored ? coinTierForFinish(i.finish, i.fieldSize) : "steel",
      finish: i.finish,
      fieldSize: i.fieldSize,
    });
  }
  return coins;
}
