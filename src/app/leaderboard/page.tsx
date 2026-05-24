import { MobileNav } from "@/components/ui/MobileNav";
import { prisma } from "@/lib/db";
import { getCommittedLayout } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { getSession } from "@/lib/session";

const EVENT_ID = 26;

export const revalidate = 60;

export default async function LeaderboardPage() {
  const layout = getCommittedLayout();
  const session = await getSession();

  const allPicks = await prisma.pick.findMany({
    where: { eventId: EVENT_ID },
    include: { player: true },
  });

  const outcomes = await prisma.stageOutcome.findMany({
    where: { eventId: EVENT_ID },
  });

  const outcomeMap: OutcomeMap = {};
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }

  const playerPickMap: PlayerPickMap = {};
  const playerMeta: Record<
    string,
    { id: string; displayName: string; avatarUrl: string | null; isLocal: boolean; synced: boolean; hasViewerPass: boolean; hasValveCoin: boolean; coinTier: string | null }
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
      const showCoin = meta.synced && meta.hasViewerPass && meta.hasValveCoin;
      return {
        playerId: pid,
        displayName: meta.displayName,
        avatarUrl: meta.avatarUrl,
        isLocal: meta.isLocal,
        synced: meta.synced,
        coinTier: showCoin ? meta.coinTier : null,
        score: score.total,
        isSelf: session?.playerId === pid,
      };
    })
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  return (
    <>
      <div style={{ padding: "var(--space-4)", position: "relative", zIndex: 1 }}>
        <header style={{ marginBottom: "var(--space-6)" }}>
          <h1
            style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--text-hi)",
              margin: 0,
            }}
          >
            Leaderboard
          </h1>
          <p style={{ color: "var(--text-mid)", fontSize: "0.875rem", margin: "var(--space-1) 0 0" }}>
            {rows.length} participant{rows.length !== 1 ? "s" : ""} · IEM Cologne 2026
          </p>
        </header>

        {rows.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "var(--space-12)",
              color: "var(--text-low)",
            }}
          >
            <p style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: "1.25rem", fontWeight: 600 }}>
              No players yet
            </p>
            <p style={{ fontSize: "0.875rem" }}>
              Be the first —{" "}
              <a href="/login" style={{ color: "var(--accent)" }}>
                sign in
              </a>{" "}
              or{" "}
              <a href="/api/auth/local" style={{ color: "var(--text-mid)" }}>
                play locally
              </a>
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {rows.map((row, idx) => {
              const rank = idx + 1;
              const isSelf = row.isSelf;

              return (
                <div
                  key={row.playerId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    padding: "var(--space-3) var(--space-4)",
                    background: isSelf ? "rgba(239,68,68,0.08)" : "var(--bg1)",
                    border: isSelf ? "1px solid rgba(239,68,68,0.3)" : "1px solid var(--bg3)",
                    borderRadius: "var(--radius-md)",
                    minHeight: 56,
                  }}
                >
                  {/* Rank */}
                  <span
                    style={{
                      width: 28,
                      fontFamily: "'Rajdhani', sans-serif",
                      fontWeight: 700,
                      fontSize: rank <= 3 ? "1.1rem" : "0.875rem",
                      color: rank === 1 ? "#f59e0b" : rank === 2 ? "#a1a1aa" : rank === 3 ? "#f97316" : "var(--text-low)",
                      textAlign: "center",
                      flexShrink: 0,
                    }}
                  >
                    {rank}
                  </span>

                  {/* Avatar */}
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: "var(--bg3)",
                      flexShrink: 0,
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {row.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.avatarUrl} alt={row.displayName} width={36} height={36} style={{ objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: "0.875rem", color: "var(--text-mid)" }}>
                        {row.displayName.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Name + provenance */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "0.9375rem",
                          color: "var(--text-hi)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.displayName}
                        {isSelf && " (you)"}
                      </span>
                      {/* Synced pill — only for Steam-synced players */}
                      {row.synced && !row.isLocal && (
                        <span
                          style={{
                            padding: "1px 6px",
                            background: "rgba(59,130,246,0.15)",
                            border: "1px solid rgba(59,130,246,0.3)",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "0.625rem",
                            fontFamily: "'Rajdhani', sans-serif",
                            fontWeight: 600,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            color: "var(--info)",
                            flexShrink: 0,
                          }}
                        >
                          Synced
                        </span>
                      )}
                    </div>
                    {/* Coin tier — ONLY when synced && hasViewerPass && hasValveCoin */}
                    {row.coinTier && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-mid)",
                          textTransform: "capitalize",
                        }}
                      >
                        {row.coinTier} coin
                      </span>
                    )}
                  </div>

                  {/* Score */}
                  <span
                    style={{
                      fontFamily: "'Rajdhani', sans-serif",
                      fontWeight: 700,
                      fontSize: "1.25rem",
                      color: row.score > 0 ? "var(--correct)" : "var(--text-low)",
                    }}
                  >
                    {row.score}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <MobileNav />
    </>
  );
}
