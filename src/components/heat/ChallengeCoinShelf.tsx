/**
 * Challenge coin case (#1278) — the collectible on a player's profile, kept the
 * way a collector keeps a struck coin: in a protective case, each Major's coin
 * resting in its own recessed felt slot with an engraved plate beneath it
 * (Major · metal · finish). Server component — it lays out the Blender-rendered
 * coin art (public/coins, see scripts/coins/) the pure core resolves; tapping a
 * coin opens the drag-to-rotate inspector.
 *
 * Empty by design until a Major concludes (coins mint at the Grand Final). On
 * your own profile the case still shows with empty slots — an obvious home for
 * coins to land (#1283). On someone else's it stays hidden so a fresh profile
 * isn't cluttered. `pending` adds the live Major's empty recess: just the bare
 * well and its plate, no caption (the empty felt says it).
 *
 * Styles: src/app/styles/sg-coins.css (.cc-*). The felt is a rendered tile
 * (/coins/felt-slot.webp) — no blur / backdrop-filter anywhere (#1269).
 */

import Link from "next/link";
import { finishLabel, type ChallengeCoin } from "@/lib/challenge-coin-core";

export { finishLabel };
import { InspectableCoin } from "@/components/heat/CoinInspector";

/** Display name without the long "CS2 Major Championship" tail. */
export function coinShortName(name: string): string {
  return name.replace(/\s+CS2 Major Championship$/i, "");
}

/**
 * One felt compartment. With a `coin` it holds the struck, inspectable coin;
 * without one it's the bare recess.
 */
export function CoinSlot({
  coin = null,
  title,
  sub,
  subTier,
  delay = 0,
}: {
  coin?: ChallengeCoin | null;
  title: string;
  sub?: string | null;
  /** Colours the plate's second line in the coin's metal. */
  subTier?: ChallengeCoin["tier"];
  delay?: number;
}) {
  return (
    <div className={`cc-slot${coin ? "" : " empty"}`}>
      {coin && (
        <div className="cc-coin">
          <InspectableCoin coin={coin} size={240} delay={delay} />
        </div>
      )}
      <div className="cc-plate">
        <span className="cc-plate-nm">{title}</span>
        {sub && <span className={`cc-plate-sub${subTier ? ` ${subTier}` : ""}`}>{sub}</span>}
      </div>
    </div>
  );
}

/** The protective case shell: hinge, felt bed, glass sheen. Children = slots. */
export function CoinCase({ slots, children }: { slots: number; children: React.ReactNode }) {
  const cols = Math.max(1, Math.min(slots, 4));
  return (
    <div
      className="cc-case"
      style={{ ["--cols" as string]: cols, ["--cols-m" as string]: Math.min(cols, 2) } as React.CSSProperties}
    >
      <span className="cc-hinge" aria-hidden="true"><i /><i /></span>
      <div className="cc-bed">{children}</div>
      <span className="cc-glass" aria-hidden="true" />
    </div>
  );
}

export function ChallengeCoinShelf({
  coins,
  isSelf,
  pending = null,
}: {
  coins: ChallengeCoin[];
  isSelf: boolean;
  /** The live Major's coin-to-be: an empty recess awaiting its strike. */
  pending?: { name: string } | null;
}) {
  if (coins.length === 0 && !isSelf) return null;

  const showPending = !!pending && (isSelf || coins.length > 0);
  const empties = coins.length === 0 && !showPending ? 3 : 0;
  const slots = coins.length + (showPending ? 1 : 0) + empties;

  return (
    <section className="chap cc-sect" data-tip="profile-coins">
      <div className="chap-h row2">
        <div>
          <h2>Challenge coins</h2>
        </div>
        <span className="cc-head-r">
          {coins.length > 0 && <span className="eyebrow">{coins.length} struck · tap to inspect</span>}
          <Link href="/coins" prefetch={false} className="eyebrow">Coin holders →</Link>
        </span>
      </div>
      <CoinCase slots={slots}>
        {coins.map((c, i) => (
          <CoinSlot
            key={c.eventId}
            coin={c}
            title={coinShortName(c.name)}
            sub={[c.tier, finishLabel(c.finish, c.fieldSize)].filter(Boolean).join(" · ")}
            subTier={c.tier}
            delay={i * 1.3}
          />
        ))}
        {showPending && pending && (
          <CoinSlot title={pending.name} />
        )}
        {Array.from({ length: empties }).map((_, i) => (
          <CoinSlot key={`empty-${i}`} title="Next Major" sub="Empty slot" />
        ))}
      </CoinCase>
    </section>
  );
}
