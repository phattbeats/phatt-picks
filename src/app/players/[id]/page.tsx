/**
 * Read-only player profile — score, picks per stage, compare CTA.
 *
 * Reached by tapping a row on the leaderboard. Applies the reveal-core gate
 * exactly like /leaderboard/compare: a player's individual team choices stay
 * hidden until the stage locks. The viewer's OWN picks are always visible to
 * themselves (no lock gate against yourself), matching the /picks page.
 */

import { notFound } from "next/navigation";
import { MobileNav } from "@/components/ui/MobileNav";
import { prisma } from "@/lib/db";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { arePicksRevealed } from "@/lib/reveal-core";
import { visibleCoinTier } from "@/lib/coin-core";
import { getSession } from "@/lib/session";

const EVENT_ID = 26;

export const revalidate = 60;

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const layout = getCommittedLayout();
  const teamMap = buildTeamMap(layout);
  const session = await getSession();

  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) notFound();

  const isSelf = session?.playerId === player.id;

  const picks = await prisma.pick.findMany({
    where: { eventId: EVENT_ID, playerId: player.id },
  });
  const outcomes = await prisma.stageOutcome.findMany({
    where: { eventId: EVENT_ID },
  });

  const outcomeMap: OutcomeMap = {};
  const groupHasOutcome = new Set<number>();
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    groupHasOutcome.add(o.groupId);
  }

  const pickMap: PlayerPickMap[string] = {};
  for (const p of picks) {
    pickMap[p.sectionId] ??= {};
    pickMap[p.sectionId][p.groupId] ??= {};
    pickMap[p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }

  const score = scorePlayer(layout, pickMap, outcomeMap).total;
  const coinTier = visibleCoinTier(player);

  const teamName = (pickId: number | undefined): string => {
    if (!pickId) return "—";
    return teamMap.get(pickId)?.name ?? `#${pickId}`;
  };

  return (
    <>
      <div style={{ padding: "var(--space-4)", position: "relative", zIndex: 1 }}>
        <header style={{ marginBottom: "var(--space-4)" }}>
          <a href="/leaderboard" style={{ color: "var(--text-mid)", fontSize: "0.8125rem", textDecoration: "none" }}>
            ← Leaderboard
          </a>
        </header>

        {/* Identity + score */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-4)",
            background: isSelf ? "rgba(239,68,68,0.08)" : "var(--bg1)",
            border: isSelf ? "1px solid rgba(239,68,68,0.3)" : "1px solid var(--bg3)",
            borderRadius: "var(--radius-lg)",
            marginBottom: "var(--space-4)",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--bg3)",
              flexShrink: 0,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {player.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={player.avatarUrl} alt={player.displayName} width={56} height={56} style={{ objectFit: "cover" }} />
            ) : (
              <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: "1.125rem", color: "var(--text-mid)" }}>
                {player.displayName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <h1
                style={{
                  fontFamily: "'Rajdhani', sans-serif",
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  color: "var(--text-hi)",
                  margin: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {player.displayName}
                {isSelf && " (you)"}
              </h1>
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-low)", margin: "2px 0 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {player.isLocal ? "Local" : player.synced ? "Steam-synced" : "Steam"}
              {coinTier && <> · {coinTier} coin</>}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "'Rajdhani', sans-serif",
                fontWeight: 700,
                fontSize: "1.75rem",
                color: score > 0 ? "var(--correct)" : "var(--text-low)",
                lineHeight: 1,
              }}
            >
              {score}
            </div>
            <div style={{ fontSize: "0.6875rem", color: "var(--text-low)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "2px" }}>
              Score
            </div>
          </div>
        </div>

        {/* Compare CTA — only if there's somebody to compare against */}
        {session && session.playerId !== player.id && (
          <a
            href={`/leaderboard/compare?b=${encodeURIComponent(player.id)}`}
            style={{
              display: "block",
              textAlign: "center",
              padding: "var(--space-3)",
              background: "var(--accent)",
              color: "#fff",
              textDecoration: "none",
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 700,
              fontSize: "0.875rem",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              borderRadius: "var(--radius-md)",
              marginBottom: "var(--space-4)",
              minHeight: 44,
              boxSizing: "border-box",
            }}
          >
            Compare with mine →
          </a>
        )}

        {/* Per-stage picks (reveal-gated against non-self viewers) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {layout.sections.map((section) => (
            <div key={section.sectionid}>
              <h2
                style={{
                  fontFamily: "'Rajdhani', sans-serif",
                  fontSize: "0.875rem",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "var(--text-mid)",
                  margin: "0 0 var(--space-2)",
                }}
              >
                {section.name.split(" | ")[0]}
              </h2>

              {section.groups.map((group) => {
                // Self always sees own picks; others wait for stage lock.
                const revealed = isSelf || arePicksRevealed(group, groupHasOutcome.has(group.groupid));
                const groupPicks = pickMap[section.sectionid]?.[group.groupid] ?? {};
                const groupOutcomes = outcomeMap[section.sectionid]?.[group.groupid] ?? {};

                return (
                  <div
                    key={group.groupid}
                    style={{
                      background: "var(--bg1)",
                      border: "1px solid var(--bg3)",
                      borderRadius: "var(--radius-md)",
                      overflow: "hidden",
                      marginBottom: "var(--space-2)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "var(--space-2) var(--space-3)",
                        borderBottom: revealed ? "1px solid var(--bg3)" : "none",
                      }}
                    >
                      <span style={{ fontSize: "0.75rem", color: "var(--text-mid)", fontWeight: 600 }}>
                        {group.name.split(" | ").slice(-1)[0]}
                      </span>
                      <span style={{ fontSize: "0.6875rem", color: "var(--accent)", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
                        {group.points_per_pick} PT{group.points_per_pick !== 1 ? "S" : ""}/PICK
                      </span>
                    </div>

                    {!revealed ? (
                      <div style={{ padding: "var(--space-3)", textAlign: "center", color: "var(--text-low)", fontSize: "0.8125rem" }}>
                        🔒 Picks hidden until this stage locks
                      </div>
                    ) : (
                      <div style={{ padding: "var(--space-2) var(--space-3)" }}>
                        {group.picks.map((slot) => {
                          const pick = groupPicks[slot.index];
                          const winner = groupOutcomes[slot.index];
                          const hit = winner !== undefined && pick === winner;
                          const miss = winner !== undefined && pick !== undefined && pick !== winner;
                          const color = hit ? "var(--correct)" : "var(--text-mid)";
                          return (
                            <div
                              key={slot.index}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "var(--space-1) 0",
                                fontSize: "0.8125rem",
                              }}
                            >
                              <span style={{ color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {hit && <strong>✓ </strong>}
                                {miss && <span style={{ color: "var(--text-low)" }}>✗ </span>}
                                {teamName(pick)}
                              </span>
                              <span style={{ color: "var(--text-low)", fontSize: "0.625rem" }}>
                                {group.picks.length > 1 ? `#${slot.index + 1}` : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <MobileNav />
    </>
  );
}
