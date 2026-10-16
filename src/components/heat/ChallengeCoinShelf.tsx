/**
 * Challenge coin case (#1278) — the collectible row on a player's profile:
 * one struck, Major-logo coin per event they took part in, its metal decided by
 * the finish. Server component — it lays out the pre-rendered coin art the pure
 * core resolves; each coin opens the drag-to-rotate inspector on tap.
 *
 * Empty by design until a Major concludes (coins mint on archive). On your own
 * profile the case still shows with empty slots — an obvious home for coins to
 * land (#1283). On someone else's it stays hidden so a fresh profile isn't
 * cluttered. `pending` adds an "in play" slot for the live Major.
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

/** Display name without the long "CS2 Major Championship" tail. */
function shortName(name: string): string {
  return name.replace(/\s+CS2 Major Championship$/i, "");
}

export function ChallengeCoinShelf({
  coins,
  isSelf,
  pending = null,
}: {
  coins: ChallengeCoin[];
  isSelf: boolean;
  /** The live Major's coin-to-be: an empty "in play" slot. */
  pending?: { name: string; note: string } | null;
}) {
  if (coins.length === 0 && !isSelf) return null;

  const empties = coins.length === 0 && !pending ? 3 : 0;

  return (
    <section className="chap coin-shelf" data-tip="profile-coins">
      <div className="chap-h row2">
        <div>
          <h2>Challenge coins</h2>
        </div>
        {coins.length > 0 && <span className="eyebrow">{coins.length} struck · tap to inspect</span>}
      </div>
      <div className="coin-shelf-grid">
        {coins.map((c, i) => (
          <div key={c.eventId} className="coin-collectible">
            <div className="coin-collectible-disc">
              <InspectableCoin coin={c} size={150} delay={i * 1.3} />
            </div>
            <div className={`coin-collectible-tier ${c.tier}`}>{c.tier}</div>
            <div className="coin-collectible-name">{shortName(c.name)}</div>
            {c.finish != null && (
              <div className="coin-collectible-finish">
                {c.finish}
                {ordSuffix(c.finish)} of {c.fieldSize}
              </div>
            )}
          </div>
        ))}
        {pending && (isSelf || coins.length > 0) && (
          <div className="coin-collectible">
            <div className="coin-collectible-disc coin-slot-empty" aria-hidden="true" />
            <div className="coin-collectible-tier">In play</div>
            <div className="coin-collectible-name">{pending.name}</div>
            <div className="coin-collectible-finish">{pending.note}</div>
          </div>
        )}
        {Array.from({ length: empties }).map((_, i) => (
          <div key={`empty-${i}`} className="coin-collectible" aria-hidden="true">
            <div className="coin-collectible-disc coin-slot-empty" />
          </div>
        ))}
      </div>
    </section>
  );
}
