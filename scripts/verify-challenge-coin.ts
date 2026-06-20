/**
 * verify-challenge-coin — offline proof for PHA-1278 (challenge coins).
 *
 * The collectible Major-logo coin track. This pins the PURE earn + tier logic
 * (challenge-coin-core) so the rules Brandon confirmed can't silently drift:
 *   • a coin mints ONLY when the player participated AND the Major concluded;
 *   • GOLD for a top-fraction finish (always the winner), STEEL otherwise;
 *   • an unscored finish still earns the STEEL coin (took part), never gold;
 *   • the art path is the slug+tier asset under /public/coins;
 *   • deriveChallengeCoins filters to earned coins and tiers each one.
 *
 * Pure-only (no prisma/fetch) — the DB assembly in challenge-coins.ts is proven
 * by reusing the same /majors maths, which verify-majors already covers.
 *
 * Run: node scripts/verify-challenge-coin.ts
 */

import {
  GOLD_TOP_FRACTION,
  isCoinEarned,
  coinTierForFinish,
  coinArtSrc,
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

// ── 2. Tier maths around the top fraction ────────────────────────────────────
check("default fraction is the top quartile", GOLD_TOP_FRACTION === 0.25);
// Field of 20, top quartile cutoff = ceil(20*0.25) = 5.
check("winner is gold", coinTierForFinish(1, 20) === "gold");
check("5th of 20 is gold (on the cutoff)", coinTierForFinish(5, 20) === "gold");
check("6th of 20 is steel (just outside)", coinTierForFinish(6, 20) === "steel");
check("last of 20 is steel", coinTierForFinish(20, 20) === "steel");
// Tiny fields: the winner is always gold even when ceil(frac*size) rounds to 1.
check("winner of a 2-player field is gold", coinTierForFinish(1, 2) === "gold");
check("2nd of a 2-player field is steel", coinTierForFinish(2, 2) === "steel");
check("solo field winner is gold", coinTierForFinish(1, 1) === "gold");
// Custom fraction is honoured (injectable cutoff).
check("custom frac 0.5 makes 5th of 10 gold", coinTierForFinish(5, 10, 0.5) === "gold");
check("custom frac 0.5 makes 6th of 10 steel", coinTierForFinish(6, 10, 0.5) === "steel");

// ── 3. Unscored / degenerate finishes fall back to steel (still earned) ──────
check("null finish -> steel", coinTierForFinish(null, 20) === "steel");
check("finish < 1 -> steel", coinTierForFinish(0, 20) === "steel");
check("empty field -> steel", coinTierForFinish(1, 0) === "steel");

// ── 4. Art path ──────────────────────────────────────────────────────────────
check("art path is /coins/<slug>-<tier>.png (gold)", coinArtSrc("iem-cologne-2026", "gold") === "/coins/iem-cologne-2026-gold.png");
check("art path is /coins/<slug>-<tier>.png (steel)", coinArtSrc("pgl-singapore-2026", "steel") === "/coins/pgl-singapore-2026-steel.png");

// ── 5. deriveChallengeCoins: filter to earned, tier each, preserve order ─────
const inputs: CoinInput[] = [
  // Concluded Major, top finish -> gold coin.
  { eventId: 26, slug: "iem-cologne-2026", name: "IEM Cologne 2026", archived: true, participated: true, scored: true, finish: 2, fieldSize: 40 },
  // Concluded Major, mid finish -> steel coin.
  { eventId: 24, slug: "old-major", name: "Old Major", archived: true, participated: true, scored: true, finish: 30, fieldSize: 40 },
  // Live Major (not archived) -> no coin yet.
  { eventId: 27, slug: "pgl-singapore-2026", name: "PGL Singapore 2026", archived: false, participated: true, scored: true, finish: 1, fieldSize: 10 },
  // Archived but never participated -> no coin.
  { eventId: 20, slug: "watched-only", name: "Watched Only", archived: true, participated: false, scored: true, finish: null, fieldSize: 5 },
  // Archived, participated, but layout unscorable -> steel coin (took part).
  { eventId: 19, slug: "unscored-major", name: "Unscored Major", archived: true, participated: true, scored: false, finish: null, fieldSize: 8 },
];
const coins = deriveChallengeCoins(inputs);
check("only earned coins come back (3 of 5)", coins.length === 3);
check("live Major minted no coin", !coins.some((c) => c.eventId === 27));
check("non-participated Major minted no coin", !coins.some((c) => c.eventId === 20));
check("top finish coin is gold", coins.find((c) => c.eventId === 26)?.tier === "gold");
check("mid finish coin is steel", coins.find((c) => c.eventId === 24)?.tier === "steel");
check("unscored-but-participated coin is steel", coins.find((c) => c.eventId === 19)?.tier === "steel");
check("input order is preserved", coins.map((c) => c.eventId).join(",") === "26,24,19");

console.log(`\nverify-challenge-coin: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
