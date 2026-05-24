/**
 * Coin / tier visibility gate (rule #4), pure.
 *
 * The Valve coin renders ONLY when a player is Steam-synced AND holds a
 * viewer pass AND actually owns the Valve coin. Local players get NO coin and
 * NO tier text, EVER — their standing is their leaderboard rank, nothing more.
 * Hiding the tier is the default; showing it is the rare exception.
 *
 * Centralized here so the leaderboard route, the page, and the verify script
 * all gate on the exact same predicate (no drift, no self-reported claims).
 */

export interface CoinFlags {
  isLocal: boolean;
  synced: boolean;
  hasViewerPass: boolean;
  hasValveCoin: boolean;
  coinTier: string | null;
}

/** True only when all three coin conditions hold (and the player is not local). */
export function shouldShowCoin(p: CoinFlags): boolean {
  // Local players can never satisfy this: they are never `synced`. The explicit
  // !isLocal guard is belt-and-suspenders so the rule reads literally.
  return !p.isLocal && p.synced && p.hasViewerPass && p.hasValveCoin;
}

/** The coin tier to render, or null when the coin must be hidden. */
export function visibleCoinTier(p: CoinFlags): string | null {
  return shouldShowCoin(p) ? p.coinTier : null;
}
