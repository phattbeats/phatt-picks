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

import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { arePicksRevealed, groupOutcomeKey } from "@/lib/reveal-core";
import { getSession } from "@/lib/session";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { isLockTimePassed } from "@/lib/lock-schedule-core";

const EVENT_ID = 26;

export const dynamic = "force-dynamic";


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
  await refreshOutcomesOnRead(EVENT_ID); // live driver (PHA-866) — shared 30s claim

  // Per-request server clock for the published lock schedule (PHA-898): a stage
  // that has begun reveals its picks for comparison even before Valve flips
  // picks_allowed or a result lands. Dynamic RSC, so reading the time is intended.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });

  // Need at least two players to compare.
  if (players.length < 2) {
    return (
      <div className="panel brk" style={{ padding: 32, textAlign: "center" }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <span className="eyebrow-mono">[ COMPARE ]</span>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: 28,
          textTransform: "uppercase",
          color: "var(--ink-hi)",
          margin: "8px 0",
        }}>
          Two players minimum
        </h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: "0 0 16px" }}>
          You need at least two players on the board before you can compare picks.
        </p>
        <Link href="/leaderboard" className="btn-ghost">← Leaderboard</Link>
      </div>
    );
  }

  // Load every pick + outcome for the event once.
  const allPicks = await prisma.pick.findMany({ where: { eventId: EVENT_ID } });
  const outcomes = await prisma.stageOutcome.findMany({ where: { eventId: EVENT_ID } });

  const outcomeMap: OutcomeMap = {};
  const groupHasOutcome = new Set<string>(); // `${sectionId}:${groupId}` with ≥1 resolved slot
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    groupHasOutcome.add(groupOutcomeKey(o.sectionId, o.groupId));
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

  // Section-qualified pick maps (sectionId → groupId → slotIndex → pickId).
  // Must NOT be keyed by groupId alone: if Valve ever reuses a groupid across
  // sections, a groupId-only map collides and a revealed (locked) section could
  // surface another still-open section's secret pick — same hazard as the
  // reveal gate above (PHA-862). Reuse toPlayerPickMap, which scoring also uses.
  const aPicksMap = toPlayerPickMap(picksByPlayer.get(aId) ?? []);
  const bPicksMap = toPlayerPickMap(picksByPlayer.get(bId) ?? []);

  const aScore = scorePlayer(layout, aPicksMap, outcomeMap).total;
  const bScore = scorePlayer(layout, bPicksMap, outcomeMap).total;

  const teamName = (pickId: number | undefined): string => {
    if (!pickId) return "—";
    return teamMap.get(pickId)?.name ?? `#${pickId}`;
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
        <span className="eyebrow-mono">[ HEAD_TO_HEAD ]</span>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: "clamp(28px, 5vw, 40px)",
          textTransform: "uppercase",
          lineHeight: 0.95,
        }}>
          Compare
        </h1>
      </div>

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
                const revealed = arePicksRevealed(
                  group,
                  groupHasOutcome.has(groupOutcomeKey(section.sectionid, group.groupid)),
                  isLockTimePassed(section.sectionid, nowMs),
                );
                const aGroup = aPicksMap[section.sectionid]?.[group.groupid] ?? {};
                const bGroup = bPicksMap[section.sectionid]?.[group.groupid] ?? {};
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
    </>
  );
}
