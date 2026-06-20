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
 * TIERS (Brandon: "diamond gold silver bronze" — mirror the Viewer Pass coin's
 * four tiers, but EARNED by finish here rather than mirrored from Valve). The
 * struck finish is decided by where the player placed among the field:
 *   • DIAMOND — the very top (the winner, or the top slice).
 *   • GOLD    — next slice.
 *   • SILVER  — next slice.
 *   • BRONZE  — everyone else who took part (the base coin for showing up).
 * Showing up earns bronze; climbing the board upgrades the finish.
 *
 * Pure module — no `@/` alias, no prisma, no fetch, no JSON import — so the
 * verify harness (scripts/verify-challenge-coin.ts) imports it directly under
 * `node --experimental-strip-types`. The I/O that assembles its inputs from the
 * database lives in the server module challenge-coins.ts.
 */

/** The four earned finishes, best → base. Mirrors the Viewer Pass coin names. */
export type CoinTier = "diamond" | "gold" | "silver" | "bronze";

/** All tiers, best-first — handy for legends/iteration. */
export const COIN_TIERS: readonly CoinTier[] = ["diamond", "gold", "silver", "bronze"];

/**
 * Finish-percentile cutoffs (inclusive upper bound, best → base): a player in
 * the top 10% strikes diamond, top 25% gold, top 50% silver, the rest bronze.
 * The outright winner is always diamond regardless of field size. Single knob —
 * retune here; the verify harness pins the maths, not the values.
 */
export const TIER_CUTOFFS: Readonly<Record<Exclude<CoinTier, "bronze">, number>> = {
  diamond: 0.1,
  gold: 0.25,
  silver: 0.5,
};

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
 * The earned tier for a finish among the field, by percentile (finish/fieldSize)
 * against TIER_CUTOFFS: diamond → gold → silver → bronze. The outright winner is
 * always diamond. An unscored / unknown finish falls back to BRONZE — you still
 * earn the coin for taking part, just the base finish. `cutoffs` is injectable so
 * the verify harness can pin the maths independent of the shipped values.
 */
export function coinTierForFinish(
  finish: number | null,
  fieldSize: number,
  cutoffs: Readonly<Record<Exclude<CoinTier, "bronze">, number>> = TIER_CUTOFFS,
): CoinTier {
  if (finish === null || finish < 1 || fieldSize < 1) return "bronze";
  if (finish === 1) return "diamond";
  const pct = finish / fieldSize;
  if (pct <= cutoffs.diamond) return "diamond";
  if (pct <= cutoffs.gold) return "gold";
  if (pct <= cutoffs.silver) return "silver";
  return "bronze";
}

/**
 * Pre-rendered FRONT art (the Major's logo face) for a Major + tier. The renders
 * are generated assets dropped under /public/coins (PHA-1278), so re-skinning a
 * Major is a one-shot asset swap — no code change. Future Majors just need their
 * four PNGs at this path; a missing asset degrades to the <Image> alt, never a
 * crash.
 */
export function coinArtSrc(slug: string, tier: CoinTier): string {
  return `/coins/${slug}-${tier}.png`;
}

/**
 * Pre-rendered BACK art for a tier — the generic struck reverse (CS2 mark +
 * "MAJOR CHALLENGE COIN"), shared across every Major so a new event only needs
 * its four front faces. Used by the inspect view's flip side.
 */
export function coinBackSrc(tier: CoinTier): string {
  return `/coins/_back-${tier}.png`;
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
      tier: i.scored ? coinTierForFinish(i.finish, i.fieldSize) : "bronze",
      finish: i.finish,
      fieldSize: i.fieldSize,
    });
  }
  return coins;
}
