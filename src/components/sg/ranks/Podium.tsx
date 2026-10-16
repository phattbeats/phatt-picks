import Image from "next/image";
import Link from "next/link";
import type { LeaderboardRow } from "@/lib/leaderboard";
import { RankAvatar } from "./RankAvatar";
import { nameFit } from "@/lib/name-fit";

/** Documentary stills behind the three podium cards (see /public/wrapped/CREDITS.md). */
const PODIUM_PHOTOS = ["/wrapped/major-champion.jpg", "/wrapped/major-cinderella.jpg", "/wrapped/major-woxic.jpg"];

/**
 * Photographic top-3 podium (prototype 03). #1 spans the full row on mobile and
 * leads a 1.6fr / 1fr / 1fr row on desktop. `final` adds champion framing.
 */
export function Podium({
  rows,
  final = false,
  hrefFor,
}: {
  rows: LeaderboardRow[];
  final?: boolean;
  hrefFor: (row: LeaderboardRow) => string;
}) {
  const top = rows.slice(0, 3);
  return (
    <div className="rk-pod">
      {top.map((row, i) => {
        const rank = i + 1;
        const label = final ? (rank === 1 ? "Champion" : rank === 2 ? "Runner-up" : "Third") : null;
        // Full name, always (Brandon) — sized to the card, wraps, no ellipsis.
        const fit = nameFit(row.displayName, "rk-pod-name");
        return (
          <Link
            key={row.playerId}
            href={hrefFor(row)}
            prefetch={false}
            className={`rk-pod-card${rank === 1 ? " one" : ""}${row.isSelf ? " me" : ""}`}
            aria-label={`${label ?? `Rank ${rank}`}: ${row.displayName}, ${row.score} points`}
          >
            <Image src={PODIUM_PHOTOS[i]} alt="" fill sizes="(min-width: 1024px) 40vw, 100vw" className="rk-pod-img" />
            {label && <span className="eyebrow rk-pod-label">{rank === 1 ? <b>{label}</b> : label}</span>}
            <span className="rk-pod-r">{String(rank).padStart(2, "0")}</span>
            <span className="rk-pod-nm">
              <RankAvatar name={row.displayName} avatarUrl={row.avatarUrl} size={rank === 1 ? 40 : 32} />
              <span className={fit.className} style={fit.style}>
                {row.displayName}
              </span>
              {row.synced && !row.isLocal && <span className="sync">synced</span>}
              {row.coinTier && (
                <span className={`coin-sticker ${row.coinTier}`} title={`${row.coinTier} coin`} role="img" aria-label={`${row.coinTier} coin`} />
              )}
            </span>
            <span className="rk-pod-f">
              <b>{row.score}</b> pts{row.isSelf ? " · you" : ""}
            </span>
          </Link>
        );
      })}
      <span className="rk-pod-credit">Photos · IEM Cologne Major 2026 · HLTV</span>
    </div>
  );
}
