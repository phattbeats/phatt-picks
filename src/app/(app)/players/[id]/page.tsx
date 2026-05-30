/**
 * Read-only player profile — score, picks per stage, compare CTA.
 *
 * Reached by tapping a row on the leaderboard. Applies the reveal-core gate
 * exactly like /leaderboard/compare: a player's individual team choices stay
 * hidden until the stage locks. The viewer's OWN picks are always visible to
 * themselves (no lock gate against yourself), matching the /picks page.
 */

import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
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
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Link href="/leaderboard" style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-mid)",
          textDecoration: "none",
        }}>
          ← Leaderboard
        </Link>
        <span className="eyebrow-mono">[ PLAYER_PROFILE ]</span>
      </div>

      {/* Identity + score */}
      <section className="panel brk" style={{
        background: isSelf ? "rgba(240,163,0,0.06)" : "var(--surf-1)",
        borderColor: isSelf ? "var(--hair-3)" : "var(--hair-2)",
      }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <div style={{
          display: "grid",
          gridTemplateColumns: "56px 1fr auto",
          gap: 14,
          alignItems: "center",
        }}>
          <div style={{
            width: 56,
            height: 56,
            border: "1px solid var(--hair-3)",
            overflow: "hidden",
            background: "linear-gradient(135deg, var(--surf-3), var(--surf-2))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            {player.avatarUrl ? (
              <Image
                src={player.avatarUrl}
                alt=""
                width={56}
                height={56}
                unoptimized
                style={{ objectFit: "cover", width: "100%", height: "100%" }}
              />
            ) : (
              <span style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 18,
                color: "var(--ink-hi)",
              }}>
                {player.displayName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="font-display" style={{
              fontWeight: 800,
              fontSize: "clamp(22px, 4vw, 30px)",
              textTransform: "uppercase",
              lineHeight: 0.95,
              color: "var(--ink-hi)",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {player.displayName}
              {isSelf && (
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  color: "var(--heat)",
                  marginLeft: 8,
                }}>
                  · YOU
                </span>
              )}
            </h1>
            <p style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--ink-mid)",
              margin: "6px 0 0",
            }}>
              {player.isLocal ? "Local" : player.synced ? "Steam-synced" : "Steam"}
              {coinTier && <> · {coinTier} coin</>}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="font-display foil" style={{
              fontWeight: 800,
              fontSize: 36,
              lineHeight: 1,
              background: "var(--foil)",
              backgroundSize: "200% 200%",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}>
              {score}
            </div>
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--ink-low)",
              marginTop: 4,
            }}>
              Score
            </div>
          </div>
        </div>
      </section>

      {/* Compare CTA — only if there's somebody to compare against */}
      {session && session.playerId !== player.id && (
        <Link
          href={`/leaderboard/compare?b=${encodeURIComponent(player.id)}`}
          className="btn-heat"
          style={{ alignSelf: "flex-start" }}
        >
          Compare with mine
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      )}

      {/* Per-stage picks (reveal-gated against non-self viewers) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {layout.sections.map((section) => (
          <div key={section.sectionid}>
            <h2 className="eyebrow-mono" style={{ marginBottom: 8, display: "block" }}>
              [ {section.name.split(" | ")[0].toUpperCase()} ]
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
    </>
  );
}
