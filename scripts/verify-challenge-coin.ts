/**
 * verify-challenge-coin — offline proof for PHA-1278 (challenge coins).
 *
 * The collectible Major-logo coin track. This pins the PURE earn + tier logic
 * (challenge-coin-core) so the rules Brandon confirmed can't silently drift:
 *   • a coin mints ONLY when the player participated AND the Major concluded;
 *   • four earned finishes by percentile — diamond / gold / silver / bronze —
 *     with the outright winner always diamond;
 *   • an unscored finish still earns the BRONZE coin (took part), never higher;
 *   • the front art path is the slug+tier asset, the back is the shared tier art;
 *   • deriveChallengeCoins filters to earned coins and tiers each one.
 *
 * Pure-only (no prisma/fetch) — the DB assembly in challenge-coins.ts is proven
 * by reusing the same /majors maths, which verify-majors already covers.
 *
 * Run: node scripts/verify-challenge-coin.ts
 */

import {
  COIN_TIERS,
  TIER_CUTOFFS,
  isCoinEarned,
  coinTierForFinish,
  coinArtSrc,
  coinBackSrc,
  deriveChallengeCoins,
  type CoinInput,
} from "../src/lib/challenge-coin-core.ts";

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

// ── 1. Earn rule: participated AND archived ──────────────────────────────────
check("earned when participated + archived", isCoinEarned({ participated: true, archived: true }) === true);
check("NOT earned when not participated", isCoinEarned({ participated: false, archived: true }) === false);
check("NOT earned while not archived (live event)", isCoinEarned({ participated: true, archived: false }) === false);
check("NOT earned when neither", isCoinEarned({ participated: false, archived: false }) === false);

// ── 2. Tier definition ───────────────────────────────────────────────────────
check("four tiers, best-first", COIN_TIERS.join(",") === "diamond,gold,silver,bronze");
check("cutoffs are diamond<gold<silver", TIER_CUTOFFS.diamond < TIER_CUTOFFS.gold && TIER_CUTOFFS.gold < TIER_CUTOFFS.silver);

// ── 3. Tier maths by finish percentile (field of 100) ────────────────────────
check("winner is diamond", coinTierForFinish(1, 100) === "diamond");
check("10th of 100 is diamond (top 10%)", coinTierForFinish(10, 100) === "diamond");
check("11th of 100 is gold", coinTierForFinish(11, 100) === "gold");
check("25th of 100 is gold (top 25%)", coinTierForFinish(25, 100) === "gold");
check("26th of 100 is silver", coinTierForFinish(26, 100) === "silver");
check("50th of 100 is silver (top 50%)", coinTierForFinish(50, 100) === "silver");
check("51st of 100 is bronze", coinTierForFinish(51, 100) === "bronze");
check("last of 100 is bronze", coinTierForFinish(100, 100) === "bronze");

// Tiny fields: the winner is always diamond even when percentile rounding is coarse.
check("winner of a 2-player field is diamond", coinTierForFinish(1, 2) === "diamond");
check("2nd of a 2-player field is bronze (pct 1.0 beyond every cutoff)", coinTierForFinish(2, 2) === "bronze");
check("solo field winner is diamond", coinTierForFinish(1, 1) === "diamond");

// Custom cutoffs are honoured (injectable).
check("custom cutoffs flip 30th of 100 to gold", coinTierForFinish(30, 100, { diamond: 0.1, gold: 0.4, silver: 0.6 }) === "gold");

// ── 4. Unscored / degenerate finishes fall back to bronze (still earned) ─────
check("null finish -> bronze", coinTierForFinish(null, 100) === "bronze");
check("finish < 1 -> bronze", coinTierForFinish(0, 100) === "bronze");
check("empty field -> bronze", coinTierForFinish(1, 0) === "bronze");

// ── 5. Art paths ──────────────────────────────────────────────────────────────
check("front art is /coins/<slug>-<tier>.png", coinArtSrc("iem-cologne-2026", "diamond") === "/coins/iem-cologne-2026-diamond.png");
check("back art is the shared /coins/_back-<tier>.png", coinBackSrc("bronze") === "/coins/_back-bronze.png");

// ── 6. deriveChallengeCoins: filter to earned, tier each, preserve order ─────
const inputs: CoinInput[] = [
  // Concluded Major, podium finish -> diamond coin.
  { eventId: 26, slug: "iem-cologne-2026", name: "IEM Cologne 2026", archived: true, participated: true, scored: true, finish: 1, fieldSize: 40 },
  // Concluded Major, mid finish -> silver coin (20/40 = top 50%).
  { eventId: 24, slug: "old-major", name: "Old Major", archived: true, participated: true, scored: true, finish: 20, fieldSize: 40 },
  // Concluded Major, back of the field -> bronze coin.
  { eventId: 23, slug: "older-major", name: "Older Major", archived: true, participated: true, scored: true, finish: 39, fieldSize: 40 },
  // Live Major (not archived) -> no coin yet.
  { eventId: 27, slug: "pgl-singapore-2026", name: "PGL Singapore 2026", archived: false, participated: true, scored: true, finish: 1, fieldSize: 10 },
  // Archived but never participated -> no coin.
  { eventId: 20, slug: "watched-only", name: "Watched Only", archived: true, participated: false, scored: true, finish: null, fieldSize: 5 },
  // Archived, participated, but layout unscorable -> bronze coin (took part).
  { eventId: 19, slug: "unscored-major", name: "Unscored Major", archived: true, participated: true, scored: false, finish: null, fieldSize: 8 },
];
const coins = deriveChallengeCoins(inputs);
check("only earned coins come back (4 of 6)", coins.length === 4);
check("live Major minted no coin", !coins.some((c) => c.eventId === 27));
check("non-participated Major minted no coin", !coins.some((c) => c.eventId === 20));
check("winner coin is diamond", coins.find((c) => c.eventId === 26)?.tier === "diamond");
check("mid finish coin is silver", coins.find((c) => c.eventId === 24)?.tier === "silver");
check("back-of-field coin is bronze", coins.find((c) => c.eventId === 23)?.tier === "bronze");
check("unscored-but-participated coin is bronze", coins.find((c) => c.eventId === 19)?.tier === "bronze");
check("input order is preserved", coins.map((c) => c.eventId).join(",") === "26,24,23,19");

console.log(`\nverify-challenge-coin: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
