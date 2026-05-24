/**
 * Pick comparison — two players side by side, per stage.
 *
 * Rule: a player's picks stay hidden until the stage LOCKS. Open stages render
 * a locked placeholder for everyone (including yourself in this view — the
 * comparison is the post-lock reveal surface). Locked stages reveal both
 * players' team choices and, where a result exists, mark hit/miss.
 *
 * Scores are always public (shown in the header); only the team choices are
 * gated. Works for local and connected players alike (rule #6).
 */

import { MobileNav } from "@/components/ui/MobileNav";
import { prisma } from "@/lib/db";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { arePicksRevealed } from "@/lib/reveal-core";
import { getSession } from "@/lib/session";

const EVENT_ID = 26;

export const revalidate = 60;

type Picks = Record<number, Record<number, number>>; // groupId -> slotIndex -> pickId

function toPlayerPickMap(picks: { sectionId: number; groupId: number; slotIndex: number; pickId: number }[]): PlayerPickMap[string] {
  const m: PlayerPickMap[string] = {};
  for (const p of picks) {
    m[p.sectionId] ??= {};
    m[p.sectionId][p.groupId] ??= {};
    m[p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }
  return m;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const params = await searchParams;
  const layout = getCommittedLayout();
  const teamMap = buildTeamMap(layout);
  const session = await getSession();

  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });

  // Need at least two players to compare.
  if (players.length < 2) {
    return (
      <>
        <div style={{ padding: "var(--space-4)" }}>
          <h1 style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: "1.5rem", fontWeight: 700, color: "var(--text-hi)" }}>
            Compare
          </h1>
          <p style={{ color: "var(--text-mid)", fontSize: "0.875rem" }}>
            Need at least two players to compare picks.
          </p>
          <a href="/leaderboard" style={{ color: "var(--accent)" }}>← Back to leaderboard</a>
        </div>
        <MobileNav />
      </>
    );
  }

  // Load every pick + outcome for the event once.
  const allPicks = await prisma.pick.findMany({ where: { eventId: EVENT_ID } });
  const outcomes = await prisma.stageOutcome.findMany({ where: { eventId: EVENT_ID } });

  const outcomeMap: OutcomeMap = {};
  const groupHasOutcome = new Set<number>(); // groupId with ≥1 resolved slot
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    groupHasOutcome.add(o.groupId);
  }

  const picksByPlayer = new Map<string, typeof allPicks>();
  for (const p of allPicks) {
    const arr = picksByPlayer.get(p.playerId) ?? [];
    arr.push(p);
    picksByPlayer.set(p.playerId, arr);
  }

  // Rank players to pick sensible defaults (self vs top opponent).
  const ranked = players
    .map((p) => ({
      player: p,
      score: scorePlayer(layout, toPlayerPickMap(picksByPlayer.get(p.id) ?? []), outcomeMap).total,
    }))
    .sort((x, y) => y.score - x.score || x.player.displayName.localeCompare(y.player.displayName));

  const defaultA = (session && ranked.find((r) => r.player.id === session.playerId)?.player.id) || ranked[0].player.id;
  const aId = params.a && players.some((p) => p.id === params.a) ? params.a : defaultA;
  const defaultB = ranked.find((r) => r.player.id !== aId)!.player.id;
  const bId = params.b && params.b !== aId && players.some((p) => p.id === params.b) ? params.b : defaultB;

  const a = players.find((p) => p.id === aId)!;
  const b = players.find((p) => p.id === bId)!;

  const aPicksMap: Picks = {};
  for (const p of picksByPlayer.get(aId) ?? []) {
    aPicksMap[p.groupId] ??= {};
    aPicksMap[p.groupId][p.slotIndex] = p.pickId;
  }
  const bPicksMap: Picks = {};
  for (const p of picksByPlayer.get(bId) ?? []) {
    bPicksMap[p.groupId] ??= {};
    bPicksMap[p.groupId][p.slotIndex] = p.pickId;
  }

  const aScore = scorePlayer(layout, toPlayerPickMap(picksByPlayer.get(aId) ?? []), outcomeMap).total;
  const bScore = scorePlayer(layout, toPlayerPickMap(picksByPlayer.get(bId) ?? []), outcomeMap).total;

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
          <h1
            style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--text-hi)",
              margin: "var(--space-1) 0 0",
            }}
          >
            Compare
          </h1>
        </header>

        {/* Player heads + scores */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: "var(--space-2)",
            marginBottom: "var(--space-4)",
            padding: "var(--space-3)",
            background: "var(--bg1)",
            border: "1px solid var(--bg3)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          {[a, b].map((p, i) => {
            const score = i === 0 ? aScore : bScore;
            return (
              <div key={p.id} style={{ textAlign: i === 0 ? "left" : "right" }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "0.9375rem",
                    color: "var(--text-hi)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.displayName}
                  {session?.playerId === p.id && " (you)"}
                </div>
                <div
                  style={{
                    fontFamily: "'Rajdhani', sans-serif",
                    fontWeight: 700,
                    fontSize: "1.5rem",
                    color: score > 0 ? "var(--correct)" : "var(--text-low)",
                  }}
                >
                  {score}
                </div>
                {/* Provenance only — local players never show a coin/tier (rule #4). */}
                <div style={{ fontSize: "0.6875rem", color: "var(--text-low)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {p.isLocal ? "Local" : p.synced ? "Synced" : "Steam"}
                </div>
              </div>
            );
          })}
          {/* center column placeholder for the grid's middle track */}
          <span style={{ color: "var(--text-low)", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>vs</span>
        </div>

        {/* Opponent switcher */}
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          {players
            .filter((p) => p.id !== aId)
            .map((p) => {
              const active = p.id === bId;
              return (
                <a
                  key={p.id}
                  href={`/leaderboard/compare?a=${aId}&b=${p.id}`}
                  style={{
                    padding: "var(--space-1) var(--space-3)",
                    borderRadius: "var(--radius-sm)",
                    background: active ? "var(--accent)" : "var(--bg2)",
                    color: active ? "#fff" : "var(--text-mid)",
                    textDecoration: "none",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    minHeight: 36,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {p.displayName}
                </a>
              );
            })}
        </div>

        {/* Per-stage comparison */}
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
                const revealed = arePicksRevealed(group, groupHasOutcome.has(group.groupid));
                const aGroup = aPicksMap[group.groupid] ?? {};
                const bGroup = bPicksMap[group.groupid] ?? {};
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
                          const aPick = aGroup[slot.index];
                          const bPick = bGroup[slot.index];
                          const winner = groupOutcomes[slot.index];
                          const mark = (pick: number | undefined) =>
                            winner === undefined ? null : pick === winner ? "✓" : "✗";
                          const markColor = (pick: number | undefined) =>
                            winner === undefined ? "var(--text-low)" : pick === winner ? "var(--correct)" : "var(--text-low)";
                          return (
                            <div
                              key={slot.index}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr auto 1fr",
                                alignItems: "center",
                                gap: "var(--space-2)",
                                padding: "var(--space-1) 0",
                                fontSize: "0.8125rem",
                              }}
                            >
                              <span style={{ color: markColor(aPick), textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {mark(aPick) && <strong>{mark(aPick)} </strong>}
                                {teamName(aPick)}
                              </span>
                              <span style={{ color: "var(--text-low)", fontSize: "0.625rem" }}>
                                {group.picks.length > 1 ? slot.index + 1 : ""}
                              </span>
                              <span style={{ color: markColor(bPick), textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {teamName(bPick)}
                                {mark(bPick) && <strong> {mark(bPick)}</strong>}
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
