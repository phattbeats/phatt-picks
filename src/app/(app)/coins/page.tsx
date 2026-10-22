/* eslint-disable @next/next/no-img-element -- editorial photo, avatars and coin art from /public. */

/**
 * Coin holders (#1278) — who holds which challenge coin, Major by Major.
 * Per concluded Major the field is grouped by metal, Diamond → Bronze, each
 * holder linking to their profile (where the coin sits in its case). A Major
 * still in play shows its empty recess: coins mint at the Grand Final.
 *
 * Read-only, derived on read: getCoinHolders scores each concluded field with
 * the leaderboard maths (two queries per Major + one player lookup), so a
 * holder's metal always agrees with their profile case and the final standings.
 */

import Link from "next/link";
import { getSession } from "@/lib/session";
import { getCoinHolders, type MajorCoinRoll } from "@/lib/challenge-coins";
import { COIN_TIERS, tierSlots, type ChallengeCoin, type CoinTier } from "@/lib/challenge-coin-core";
import { InspectableCoin } from "@/components/heat/CoinInspector";
import { CoinCase, CoinSlot, finishLabel } from "@/components/heat/ChallengeCoinShelf";
import { dayMonth, majorShortName, monthYear } from "@/components/sg/people/people-data";
import { PHOTOS } from "@/lib/photos";

export const metadata = { title: "Coin holders · HOTLINE" };

const TIER_RULE: Record<CoinTier, string> = {
  diamond: "Winner · top 10%",
  gold: "Top 25%",
  silver: "Top 50%",
  bronze: "Took part",
};

/** "#2", "#3–4", or null when the tier reaches no places in this field. */
function placeRange(lo: number, hi: number): string | null {
  if (hi < lo) return null;
  return lo === hi ? `#${lo}` : `#${lo}–${hi}`;
}

/** The places each tier covered in a field of `n` (rank slots, rounded up). */
function tierPlaces(n: number): Record<CoinTier, string | null> {
  const s = tierSlots(n);
  return {
    diamond: placeRange(1, s.diamond),
    gold: placeRange(s.diamond + 1, s.gold),
    silver: placeRange(s.gold + 1, s.silver),
    bronze: placeRange(s.silver + 1, n),
  };
}

function initials(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 2).toUpperCase() || "··";
}

function StruckMajor({ roll, viewerId }: { roll: MajorCoinRoll; viewerId: string | null }) {
  const places = tierPlaces(roll.fieldSize);
  const short = majorShortName(roll);
  const mintedIso = roll.mintedAtMs != null ? new Date(roll.mintedAtMs).toISOString() : null;
  const majorQ = `?major=${encodeURIComponent(roll.slug)}`;
  return (
    <section className="chap ch-major">
      <div className="chap-h row2">
        <div>
          <span className="n">
            {monthYear(roll.start)}
            {mintedIso && <> · Struck {dayMonth(mintedIso)}</>}
          </span>
          <h2>{short}</h2>
          <p>
            <b>{roll.holders.length} coin{roll.holders.length !== 1 ? "s" : ""}</b> struck from a field of{" "}
            {roll.fieldSize}.
          </p>
        </div>
        <Link href={`/leaderboard${majorQ}`} prefetch={false} className="eyebrow">Final standings →</Link>
      </div>
      <div className="ch-tiers">
        {COIN_TIERS.map((tier, ti) => {
          const holders = roll.holders.filter((h) => h.coin.tier === tier);
          const art: ChallengeCoin = holders[0]?.coin ?? {
            eventId: roll.eventId,
            slug: roll.slug,
            name: roll.name,
            tier,
            finish: null,
            fieldSize: roll.fieldSize,
            earnedAtMs: roll.mintedAtMs ?? 0,
          };
          const rule = [TIER_RULE[tier], places[tier]].filter(Boolean).join(" · ");
          return (
            <div key={tier} className="ch-tier">
              <div className="ch-coin">
                <InspectableCoin coin={{ ...art, finish: null, holder: null }} size={112} delay={ti * 1.2} />
              </div>
              <div className="ch-tier-k">
                <span className={`ch-tier-nm ${tier}`}>{tier}</span>
                <span className="ch-tier-rule">{rule}</span>
              </div>
              <div className="ch-holders">
                {holders.length === 0 ? (
                  <span className="ch-none">
                    {places[tier] ? `Nobody holds ${tier} from this Major.` : `No ${tier} places in a field this size.`}
                  </span>
                ) : (
                  holders.map((h) => (
                    <Link
                      key={h.playerId}
                      href={`/players/${encodeURIComponent(h.playerId)}`}
                      prefetch={false}
                      className={`ch-holder${h.playerId === viewerId ? " you" : ""}`}
                    >
                      <span className="av">
                        {h.avatarUrl ? <img src={h.avatarUrl} alt="" width={32} height={32} loading="lazy" /> : initials(h.displayName)}
                      </span>
                      <span className="ch-holder-nm">{h.displayName}</span>
                      {finishLabel(h.coin.finish, h.coin.fieldSize) && (
                        <span className="ch-holder-f">{finishLabel(h.coin.finish, h.coin.fieldSize)}</span>
                      )}
                    </Link>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PendingMajor({ roll }: { roll: MajorCoinRoll }) {
  const short = majorShortName(roll);
  return (
    <section className="chap">
      <div className="chap-h">
        <span className="n">{monthYear(roll.start)} · Still to mint</span>
        <h2>{short}</h2>
      </div>
      <div className="ch-pending">
        <CoinCase slots={1}>
          <CoinSlot title={short} sub="To be minted" emptyNote="Mints at the Grand Final" />
        </CoinCase>
        <p>
          Make at least one pick and your {short} coin is struck the moment its Grand Final ends.{" "}
          <b>Where you finish decides the metal</b> — every holder lands here.
        </p>
      </div>
    </section>
  );
}

export default async function CoinsPage() {
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const session = await getSession();
  const rolls = await getCoinHolders(nowMs);
  const struck = rolls.filter((r) => r.mintedAtMs !== null);
  const pending = rolls.filter((r) => r.mintedAtMs === null);
  const total = struck.reduce((n, r) => n + r.holders.length, 0);

  return (
    <div className="pp-page">
      <section className="bleed short">
        <img src={PHOTOS.coinsHero} alt="" />
        <span className="credit">Photo · HLTV</span>
        {/* the four metals at a 3/4 angle (render-coin.py --mode beauty); diamond on top */}
        <div className="ch-fan" aria-hidden="true">
          {[...COIN_TIERS].reverse().map((t) => (
            <img key={t} src={`/coins/beauty-${t}.png`} alt="" className={t} />
          ))}
        </div>
        <div className="in">
          <span className="eyebrow rise">
            Challenge coins · <b>{total} struck</b>
          </span>
          <h1 className="display rise d1">Coin holders</h1>
          <p className="rise d2">
            One coin per Major you play, struck at the Grand Final. <b>Where you finished decided the metal.</b>
          </p>
        </div>
      </section>

      {pending.map((r) => (
        <PendingMajor key={r.eventId} roll={r} />
      ))}

      {struck.length === 0 ? (
        <section className="chap">
          <div className="chap-h">
            <h2>No coins struck yet</h2>
            <p>Coins mint when a Major&apos;s Grand Final ends. The first holders land here.</p>
          </div>
        </section>
      ) : (
        struck.map((r) => <StruckMajor key={r.eventId} roll={r} viewerId={session?.playerId ?? null} />)
      )}

      <section className="chap">
        <div className="chap-h">
          <p>
            How the metals work: <Link href="/how-to-play" prefetch={false}>How it works</Link> ·{" "}
            <Link href="/faq" prefetch={false}>FAQ</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
