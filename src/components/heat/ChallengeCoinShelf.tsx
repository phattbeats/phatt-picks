/**
 * Challenge coin case (#1278) — the collectible on a player's profile, kept the
 * way a collector keeps a struck coin: in a protective case, each Major's coin
 * resting in its own recessed felt slot with an engraved plate beneath it
 * (Major, holder, metal · finish). Server component — it lays out the Blender-rendered
 * coin art (public/coins, see scripts/coins/) the pure core resolves; tapping a
 * coin opens the drag-to-rotate inspector.
 *
 * The case is a rectangle of four slots (more rows of four as a collection
 * grows), filled in order: struck coins newest first, then the live Major's
 * bare well with its plate (`pending`), then bare wells. No captions; the empty
 * felt says it. On someone else's profile a case with no coins stays hidden.
 * The same row of slots is handed to the inspector, so its 3D case opens on
 * exactly what you tapped.
 *
 * Styles: src/app/styles/sg-coins.css (.cc-*). The felt is a rendered tile
 * (/coins/felt-slot.webp) — no blur / backdrop-filter anywhere (#1269).
 */

import Link from "next/link";
import { coinArtSrc, finishLabel, type ChallengeCoin } from "@/lib/challenge-coin-core";
import type { CaseView } from "@/components/heat/CoinInspector";

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
  caseView = null,
}: {
  coin?: ChallengeCoin | null;
  /** The plate; a slot without one is a bare well. */
  title?: string | null;
  sub?: string | null;
  /** Colours the plate's second line in the coin's metal. */
  subTier?: ChallengeCoin["tier"];
  delay?: number;
  caseView?: CaseView | null;
}) {
  return (
    <div className={`cc-slot${coin ? "" : " empty"}`}>
      {coin && (
        <div className="cc-coin">
          <InspectableCoin coin={coin} size={240} delay={delay} caseView={caseView} />
        </div>
      )}
      {title && (
        <div className="cc-plate">
          <span className="cc-plate-nm">{title}</span>
          {coin?.holder && <span className="cc-plate-who">{coin.holder}</span>}
          {sub && <span className={`cc-plate-sub${subTier ? ` ${subTier}` : ""}`}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

/** One slot of a case: a coin with its plate, a plate over a bare well, or a bare well. */
export interface CaseItem {
  coin?: ChallengeCoin | null;
  title?: string | null;
  sub?: string | null;
}

/** Pad to whole rows of four. */
export function fillRows(items: CaseItem[]): CaseItem[] {
  const n = Math.max(4, Math.ceil(items.length / 4) * 4);
  return [...items, ...Array.from({ length: n - items.length }, () => ({}))];
}

/** The inspector's view of the row slot `i` sits in. */
export function caseViewFor(items: CaseItem[], i: number): CaseView {
  const start = Math.floor(i / 4) * 4;
  return {
    index: i - start,
    slots: items.slice(start, start + 4).map((it) => ({
      art: it.coin ? coinArtSrc(it.coin.slug, it.coin.tier) : null,
      plate: it.title ? { title: it.title, who: it.coin?.holder ?? null, sub: it.sub ?? null } : null,
    })),
  };
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

  const items = fillRows([
    ...coins.map((c) => ({
      coin: c,
      title: coinShortName(c.name),
      sub: [c.tier, finishLabel(c.finish, c.fieldSize)].filter(Boolean).join(" · "),
    })),
    ...(pending ? [{ title: pending.name }] : []),
  ]);

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
      <CoinCase slots={4}>
        {items.map((it, i) => (
          <CoinSlot
            key={it.coin ? it.coin.eventId : `slot-${i}`}
            coin={it.coin}
            title={it.title}
            sub={it.sub}
            subTier={it.coin?.tier}
            delay={i * 1.3}
            caseView={it.coin ? caseViewFor(items, i) : null}
          />
        ))}
      </CoinCase>
    </section>
  );
}
