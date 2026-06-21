/**
 * Challenge coin shelf (PHA-1278) — the collectible row on a player's profile:
 * one struck, Major-logo coin per event they took part in, gold for a top finish
 * and steel for taking part. Server component (no interactivity) — it just lays
 * out the pre-rendered coin art the pure core resolves.
 *
 * Empty by design until a Major concludes (coins mint on archive). On your own
 * profile the velvet display case still shows with empty recesses — no explainer
 * text (PHA-1283: let people figure it out), just an obvious home for coins to
 * land. On someone else's it stays hidden so a fresh profile isn't cluttered.
 */

import { type ChallengeCoin } from "@/lib/challenge-coin-core";
import { InspectableCoin } from "@/components/heat/CoinInspector";

function ordSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

export function ChallengeCoinShelf({
  coins,
  isSelf,
}: {
  coins: ChallengeCoin[];
  isSelf: boolean;
}) {
  // Empty velvet case on your own profile — the display case stays so there's an
  // obvious home for coins, but the explainer text is gone (PHA-1283). Three
  // empty recesses read as "a coin sits in each of these" without spelling it
  // out. Hidden on other people's profiles so a fresh one isn't cluttered.
  if (coins.length === 0) {
    if (!isSelf) return null;
    return (
      <section className="coin-shelf">
        <div className="coin-shelf-head">
          <span className="eyebrow-mono">CHALLENGE COINS</span>
        </div>
        <div className="coin-shelf-grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="coin-collectible">
              <div className="coin-collectible-disc coin-slot-empty" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="coin-shelf">
      <div className="coin-shelf-head">
        <span className="eyebrow-mono">CHALLENGE COINS</span>
        <span className="coin-shelf-count">{coins.length}</span>
      </div>
      <div className="coin-shelf-grid">
        {coins.map((c, i) => (
          <div key={c.eventId} className="coin-collectible">
            <div className="coin-collectible-disc">
              <InspectableCoin coin={c} size={112} delay={i * 1.3} />
            </div>
            <div className={`coin-collectible-tier ${c.tier}`}>{c.tier}</div>
            <div className="coin-collectible-name">{c.name}</div>
            {c.finish != null && (
              <div className="coin-collectible-finish">
                {c.finish}
                {ordSuffix(c.finish)} of {c.fieldSize}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
