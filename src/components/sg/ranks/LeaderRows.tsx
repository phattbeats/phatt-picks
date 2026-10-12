import Link from "next/link";
import type { LeaderboardRow } from "@/lib/leaderboard";
import type { RankDelta } from "@/lib/rank-snapshot-core";
import { RankAvatar } from "./RankAvatar";

/** Rank movement: ▲N climbed, ▼N dropped, — held, NEW. */
function RankArrow({ delta }: { delta?: RankDelta }) {
  if (!delta) return <span className="rk-d" />;
  if (delta.direction === "new") {
    return <span className="rk-d" title="New this stage">NEW</span>;
  }
  if (delta.direction === "flat") {
    return <span className="rk-d" title="No change">—</span>;
  }
  const moved = Math.abs(delta.delta ?? 0);
  const up = delta.direction === "up";
  return (
    <span className={`rk-d ${up ? "up" : "dn"}`} title={`${up ? "Up" : "Down"} ${moved} since last stage`}>
      {up ? "▲" : "▼"}
      {moved}
    </span>
  );
}

/** Hairline ranking rows (prototype 03 "The field"). */
export function LeaderRows({
  rows,
  startRank = 1,
  deltas,
  showDelta,
  hrefFor,
}: {
  rows: LeaderboardRow[];
  startRank?: number;
  deltas: Map<string, RankDelta>;
  showDelta: boolean;
  hrefFor: (row: LeaderboardRow) => string;
}) {
  return (
    <div className={`rk-rows${showDelta ? " with-d" : ""}`}>
      {rows.map((row, i) => {
        const rank = startRank + i;
        return (
          <Link key={row.playerId} href={hrefFor(row)} prefetch={false} className={row.isSelf ? "me" : undefined}>
            <span className={`rk-r${rank <= 3 ? " top" : ""}`}>{String(rank).padStart(2, "0")}</span>
            <span className="rk-who">
              <RankAvatar name={row.displayName} avatarUrl={row.avatarUrl} />
              <span className="rk-nm">{row.displayName}</span>
              {row.isSelf && <span className="rk-you">you</span>}
              {row.synced && !row.isLocal && <span className="sync">synced</span>}
              {row.coinTier && (
                <span className={`coin-sticker ${row.coinTier}`} title={`${row.coinTier} coin`} role="img" aria-label={`${row.coinTier} coin`} />
              )}
            </span>
            {showDelta && <RankArrow delta={deltas.get(row.playerId)} />}
            <span className={`rk-p${row.score > 0 ? "" : " zero"}`}>{row.score}</span>
          </Link>
        );
      })}
    </div>
  );
}
