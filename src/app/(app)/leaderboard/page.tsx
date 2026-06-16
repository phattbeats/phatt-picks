import Link from "next/link";
import Image from "next/image";
import { LastUpdated } from "@/components/LastUpdated";
import { prisma } from "@/lib/db";
import { getCommittedLayout } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { visibleCoinTier } from "@/lib/coin-core";
import { getSession } from "@/lib/session";
import { rankMapForSection, snapshotSectionIds } from "@/lib/rank-snapshot";
import { baselineSectionId, latestSectionId, rankDelta, type RankDelta } from "@/lib/rank-snapshot-core";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { currentEventId } from "@/lib/events-core";

export default async function LeaderboardPage() {
  // Per-request active event (PHA-1046) — follows the clock across Majors, no redeploy.
  const EVENT_ID = currentEventId();
  const layout = getCommittedLayout();
  const session = await getSession();

  // Live driver (PHA-866): atomic 30s claim → deferred background ingest, so the
  // board never sits frozen mid-event. No cron, no added latency (the slow ingest
  // runs past the response via `after`).
  await refreshOutcomesOnRead(EVENT_ID);

  const allPicks = await prisma.pick.findMany({
    where: { eventId: EVENT_ID },
    include: { player: true },
  });

  const outcomes = await prisma.stageOutcome.findMany({
    where: { eventId: EVENT_ID },
  });

  const latestResolvedAt = outcomes.reduce<Date | null>(
    (max, o) => (max === null || o.resolvedAt > max ? o.resolvedAt : max),
    null,
  );

  const outcomeMap: OutcomeMap = {};
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }

  const playerPickMap: PlayerPickMap = {};
  const playerMeta: Record<
    string,
    {
      id: string;
      displayName: string;
      avatarUrl: string | null;
      isLocal: boolean;
      synced: boolean;
      hasViewerPass: boolean;
      hasValveCoin: boolean;
      coinTier: string | null;
    }
  > = {};

  for (const pick of allPicks) {
    const pid = pick.playerId;
    playerPickMap[pid] ??= {};
    playerPickMap[pid][pick.sectionId] ??= {};
    playerPickMap[pid][pick.sectionId][pick.groupId] ??= {};
    playerPickMap[pid][pick.sectionId][pick.groupId][pick.slotIndex] = pick.pickId;

    if (!playerMeta[pid]) {
      const p = pick.player;
      playerMeta[pid] = {
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        isLocal: p.isLocal,
        synced: p.synced,
        hasViewerPass: p.hasViewerPass,
        hasValveCoin: p.hasValveCoin,
        coinTier: p.coinTier,
      };
    }
  }

  const allPlayers = await prisma.player.findMany();
  for (const p of allPlayers) {
    if (!playerMeta[p.id]) {
      playerMeta[p.id] = {
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        isLocal: p.isLocal,
        synced: p.synced,
        hasViewerPass: p.hasViewerPass,
        hasValveCoin: p.hasValveCoin,
        coinTier: p.coinTier,
      };
    }
  }

  const rows = Object.entries(playerMeta)
    .map(([pid, meta]) => {
      const picks = playerPickMap[pid] ?? {};
      const score = scorePlayer(layout, picks, outcomeMap);
      return {
        playerId: pid,
        displayName: meta.displayName,
        avatarUrl: meta.avatarUrl,
        isLocal: meta.isLocal,
        synced: meta.synced,
        coinTier: visibleCoinTier(meta),
        score: score.total,
        isSelf: session?.playerId === pid,
      };
    })
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  // Rank-delta arrows (mockup-04). Movement is measured across the most recently
  // resolved stage: current live rank vs. the snapshot frozen at the previous
  // resolved stage. Before two stages have resolved there's nothing to diff, so
  // no arrows render (honest — we never invent movement).
  const resolvedSections = await snapshotSectionIds(EVENT_ID);
  const baseSection = baselineSectionId(resolvedSections);
  const baselineRanks = await rankMapForSection(EVENT_ID, baseSection);
  const latestSection = latestSectionId(resolvedSections);
  const deltaByPlayer = new Map<string, RankDelta>();
  rows.forEach((row, idx) => {
    deltaByPlayer.set(row.playerId, rankDelta(idx + 1, baselineRanks.get(row.playerId)));
  });
  const showDeltas = baseSection !== null;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">STANDINGS</span>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <h1 className="font-display" style={{
            fontWeight: 800,
            fontSize: "clamp(28px, 5vw, 40px)",
            textTransform: "uppercase",
            lineHeight: 0.95,
          }}>
            Leaderboard
          </h1>
          {rows.length >= 2 && (
            <Link href="/leaderboard/compare" className="btn-ghost" style={{ padding: "10px 16px", fontSize: 12 }}>
              Compare picks
              <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          )}
        </div>
        <p style={{
          color: "var(--ink-mid)",
          fontSize: 13,
          margin: 0,
        }}>
          {rows.length} participant{rows.length !== 1 ? "s" : ""} · IEM Cologne 2026 ·{" "}
          <Link href="/players" style={{ color: "var(--heat)", textDecoration: "none" }}>
            directory →
          </Link>{" "}
          ·{" "}
          <Link href="/majors" style={{ color: "var(--heat)", textDecoration: "none" }}>
            your Majors →
          </Link>
        </p>
        {latestSection !== null && (
          <Link
            href={`/reveal/${latestSection}`}
            className="btn-ghost"
            style={{ padding: "10px 16px", fontSize: 12, alignSelf: "flex-start", marginTop: 2 }}
          >
            Latest Stage Reveal
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="panel brk" style={{ textAlign: "center", padding: "48px 24px" }}>
          <span className="br-tr" />
          <span className="br-bl" />
          <p className="font-display" style={{
            fontWeight: 700,
            fontSize: 22,
            color: "var(--ink-hi)",
            textTransform: "uppercase",
            margin: "0 0 6px",
          }}>
            No players yet
          </p>
          <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: 0 }}>
            Be the first —{" "}
            <Link href="/login/auth" style={{ color: "var(--heat)" }}>sign in</Link>{" "}
            or{" "}
            <Link href="/login/local" style={{ color: "var(--ink-mid)" }}>play locally</Link>.
          </p>
        </div>
      ) : (
        <>
          {/* Podium — top 3 (mockup 04). Order 2 · 1 · 3 so #1 centers. */}
          {rows.length >= 3 && (
            <div className="podium">
              {[1, 0, 2].map((i) => {
                const row = rows[i];
                const rank = i + 1;
                const first = i === 0;
                return (
                  <Link
                    key={row.playerId}
                    href={`/players/${encodeURIComponent(row.playerId)}`}
                    className={`podium-slot${first ? " first brk" : ""}`}
                  >
                    {first && (
                      <>
                        <span className="br-tr" />
                        <span className="br-bl" />
                      </>
                    )}
                    <span className="podium-rank">{String(rank).padStart(2, "0")}</span>
                    <span className="podium-av">
                      {row.avatarUrl ? (
                        <Image src={row.avatarUrl} alt="" width={first ? 52 : 44} height={first ? 52 : 44} unoptimized style={{ objectFit: "cover", width: "100%", height: "100%" }} />
                      ) : (
                        row.displayName.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span className="podium-name">{row.displayName}</span>
                    <span className="podium-score">{row.score}</span>
                    <span className="podium-pts">pts</span>
                    {row.coinTier && <span className={`coin-sticker ${row.coinTier}`} title={`${row.coinTier} coin`} />}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Full rankings */}
          <div className="section-label" style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ink-low)",
            margin: "4px 0 2px",
          }}>
            Full Rankings
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((row, idx) => (
              <LeaderRow
                key={row.playerId}
                row={row}
                rank={idx + 1}
                delta={deltaByPlayer.get(row.playerId)}
                showDelta={showDeltas}
              />
            ))}
          </div>
        </>
      )}

      <footer style={{
        marginTop: 12,
        paddingTop: 16,
        borderTop: "1px solid var(--hair-2)",
        textAlign: "center",
      }}>
        <p style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-mid)",
          margin: 0,
        }}>
          {latestResolvedAt ? (
            <LastUpdated iso={latestResolvedAt.toISOString()} />
          ) : (
            "Scores update from official results as each stage completes."
          )}
        </p>
        <p style={{
          fontFamily: "var(--font-mono)",
          color: "var(--ink-mid)",
          fontSize: 10.5,
          margin: "6px 0 0",
          letterSpacing: "0.08em",
        }}>
          Results:{" "}
          <a
            href="https://liquipedia.net"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--ink-mid)" }}
          >
            Liquipedia
          </a>{" "}
          (CC-BY-SA 3.0)
        </p>
      </footer>
    </>
  );
}

/** Rank movement chip for mockup-04: ↑N climbed, ↓N dropped, — held, NEW. */
function RankArrow({ delta }: { delta?: RankDelta }) {
  if (!delta) return null;
  const base = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 600,
    textAlign: "right" as const,
    minWidth: 24,
  };
  if (delta.direction === "new") {
    return <span style={{ ...base, fontSize: 8, letterSpacing: "0.1em", color: "var(--ink-low)", textTransform: "uppercase" }} title="New this stage">NEW</span>;
  }
  const moved = Math.abs(delta.delta ?? 0);
  if (delta.direction === "flat") {
    return <span style={{ ...base, color: "var(--ink-low)" }} title="No change">—</span>;
  }
  const up = delta.direction === "up";
  return (
    <span
      style={{ ...base, color: up ? "var(--tac-green, #9bd23c)" : "var(--ember, #d8351c)" }}
      title={`${up ? "Up" : "Down"} ${moved} since last stage`}
    >
      {up ? "↑" : "↓"}{moved}
    </span>
  );
}

function LeaderRow({
  row,
  rank,
  delta,
  showDelta,
}: {
  row: {
    playerId: string;
    displayName: string;
    avatarUrl: string | null;
    isLocal: boolean;
    synced: boolean;
    coinTier: string | null;
    score: number;
    isSelf: boolean;
  };
  rank: number;
  delta?: RankDelta;
  showDelta: boolean;
}) {
  const isPodium = rank <= 3;
  return (
    <Link
      href={`/players/${encodeURIComponent(row.playerId)}`}
      style={{
        display: "grid",
        gridTemplateColumns: showDelta ? "32px 40px 1fr auto auto" : "32px 40px 1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "12px 16px",
        background: row.isSelf
          ? "rgba(240,163,0,0.07)"
          : "var(--surf-1)",
        border: row.isSelf ? "1px solid var(--hair-3)" : "1px solid var(--hair)",
        textDecoration: "none",
        color: "inherit",
        minHeight: 60,
        transition: "border-color 160ms var(--ease), background 160ms var(--ease)",
      }}
    >
      <span style={{
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        fontSize: isPodium ? 16 : 13,
        color: isPodium ? "var(--heat)" : "var(--ink-mid)",
        textAlign: "center",
      }}>
        {String(rank).padStart(2, "0")}
      </span>

      <div style={{
        width: 40,
        height: 40,
        borderRadius: "var(--r-sm)",
        border: "1px solid var(--hair-2)",
        overflow: "hidden",
        background: row.avatarUrl ? "var(--surf-2)" : "linear-gradient(135deg, var(--surf-3), var(--surf-2))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        {row.avatarUrl ? (
          <Image
            src={row.avatarUrl}
            alt=""
            width={40}
            height={40}
            unoptimized
            style={{ objectFit: "cover", width: "100%", height: "100%" }}
          />
        ) : (
          <span style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 14,
            color: "var(--ink-mid)",
          }}>
            {row.displayName.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontWeight: 500,
            fontSize: 14,
            color: "var(--ink-hi)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {row.displayName}
          </span>
          {row.isSelf && (
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.1em",
              color: "var(--heat)",
              textTransform: "uppercase",
            }}>
              · you
            </span>
          )}
          {row.synced && !row.isLocal && (
            <span style={{
              padding: "2px 6px",
              background: "rgba(240,163,0,0.1)",
              border: "1px solid var(--hair-3)",
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--heat)",
            }}>
              Synced
            </span>
          )}
        </div>
        {row.coinTier && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className={`coin-sticker ${row.coinTier}`} title={`${row.coinTier} coin`} />
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "var(--ink-mid)",
              textTransform: "uppercase",
            }}>
              {row.coinTier} coin
            </span>
          </span>
        )}
      </div>

      {showDelta && <RankArrow delta={delta} />}

      <span style={{
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        fontSize: 20,
        color: row.score > 0 ? "var(--ink-hi)" : "var(--ink-low)",
      }}>
        {row.score}
      </span>
    </Link>
  );
}
