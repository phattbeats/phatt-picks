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
import { arePicksRevealed, groupOutcomeKey } from "@/lib/reveal-core";
import { isLockTimePassed } from "@/lib/lock-schedule-core";
import { visibleCoinTier } from "@/lib/coin-core";
import { getSession } from "@/lib/session";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import { bucketSwissSlots, isSwissSection } from "@/lib/swiss-bucket-core";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { buildConsensus, consensusKey, shareFor } from "@/lib/consensus-core";
import type { Section } from "@/lib/layout";

const EVENT_ID = 26;

function ordSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatJoin(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Short pick-type tag for a slot (3:0 / 3:1·3:2 / 0:3 for Swiss; — otherwise). */
function bucketLabelFor(sectionId: number, group: Section["groups"][number], slotIndex: number): string | null {
  if (!isSwissSection(sectionId)) return null;
  const buckets = bucketSwissSlots(group.picks.length);
  const hit = buckets.find((b) => b.slotIndexes.includes(slotIndex));
  if (!hit || hit.label === "PICKS") return null;
  return hit.label.replace(" ADVANCED", "").replace(" ELIMINATED", "");
}


export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const layout = getCommittedLayout();
  const teamMap = buildTeamMap(layout);
  const session = await getSession();
  await refreshOutcomesOnRead(EVENT_ID); // live driver (PHA-866) — shared 30s claim

  // Published lock schedule (PHA-898): reveal a started stage's picks even before
  // Valve flips picks_allowed or a result lands. Dynamic RSC — time read intended.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

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
  const groupHasOutcome = new Set<string>(); // `${sectionId}:${groupId}` with ≥1 resolved slot
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    groupHasOutcome.add(groupOutcomeKey(o.sectionId, o.groupId));
  }

  const pickMap: PlayerPickMap[string] = {};
  for (const p of picks) {
    pickMap[p.sectionId] ??= {};
    pickMap[p.sectionId][p.groupId] ??= {};
    pickMap[p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }

  const score = scorePlayer(layout, pickMap, outcomeMap).total;
  const coinTier = visibleCoinTier(player);

  // Rank — score this player against the whole field (mockup-06 stat hero).
  const allPlayers = await prisma.player.findMany({ select: { id: true, displayName: true } });
  const allPicks = await prisma.pick.findMany({
    where: { eventId: EVENT_ID },
    select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
  });
  // Field-wide pick distribution per slot (PHA-889). Only surfaced on revealed
  // (post-lock) groups below, so it never leaks live picks or invites herding.
  const consensus = buildConsensus(allPicks);

  const everyPickMap: PlayerPickMap = {};
  for (const p of allPicks) {
    everyPickMap[p.playerId] ??= {};
    everyPickMap[p.playerId][p.sectionId] ??= {};
    everyPickMap[p.playerId][p.sectionId][p.groupId] ??= {};
    everyPickMap[p.playerId][p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }
  const standings = allPlayers
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      score: scorePlayer(layout, everyPickMap[p.id] ?? {}, outcomeMap).total,
    }))
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
  const rank = standings.findIndex((r) => r.id === player.id) + 1;
  const leaderScore = standings[0]?.score ?? 0;
  const fieldSize = standings.length;

  // Accuracy — correct picks over resolved picks (only counts decided slots).
  let resolved = 0;
  let correct = 0;
  for (const section of layout.sections) {
    for (const group of section.groups) {
      const gOut = outcomeMap[section.sectionid]?.[group.groupid] ?? {};
      const gPick = pickMap[section.sectionid]?.[group.groupid] ?? {};
      for (const slot of group.picks) {
        const winner = gOut[slot.index];
        if (winner === undefined) continue;
        resolved += 1;
        if (gPick[slot.index] === winner) correct += 1;
      }
    }
  }
  const accuracy = resolved > 0 ? Math.round((correct / resolved) * 100) : null;

  const maxPoints = layout.sections.reduce(
    (acc, s) => acc + s.groups.reduce((g, grp) => g + grp.picks.length * grp.points_per_pick, 0),
    0,
  );

  const joinLabel = formatJoin(player.createdAt);
  const provenance = player.isLocal ? "Local" : player.synced ? "Steam-synced" : "Steam";

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

      {/* Hero (mockup 06) */}
      <section className="profile-hero brk" style={{
        background: isSelf ? "rgba(240,163,0,0.06)" : "var(--surf-1)",
        borderColor: isSelf ? "var(--hair-3)" : "var(--hair-2)",
      }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <div className="profile-av">
          {player.avatarUrl ? (
            <Image src={player.avatarUrl} alt="" width={60} height={60} unoptimized style={{ objectFit: "cover", width: "100%", height: "100%" }} />
          ) : (
            player.displayName.slice(0, 2).toUpperCase()
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 className="profile-name">
            {player.displayName}
            {isSelf && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", color: "var(--heat)", marginLeft: 8 }}>· YOU</span>
            )}
          </h1>
          <div className="profile-meta">IEM Cologne 2026{joinLabel ? ` · Joined ${joinLabel}` : ""}</div>
          <span className="synced-pill">{provenance}</span>
        </div>
      </section>

      {/* Stat cards (mockup 06) */}
      <div className="statcards">
        <div className="statcard">
          <div className="statcard-lbl">Rank</div>
          <div className="statcard-val">
            {rank > 0 ? <>{rank}<small>{ordSuffix(rank)}</small></> : "—"}
          </div>
          <div className="statcard-sub">
            {rank > 0
              ? rank === 1
                ? fieldSize > 1 ? "Leading the board" : "Only player"
                : `${leaderScore - score} from leader`
              : "Unranked"}
          </div>
        </div>
        <div className="statcard">
          <div className="statcard-lbl">Points</div>
          <div className="statcard-val foil">{score}</div>
          <div className="statcard-sub">of {maxPoints} max</div>
        </div>
        <div className="statcard">
          <div className="statcard-lbl">Accuracy</div>
          <div className="statcard-val">
            {accuracy === null ? "—" : <>{accuracy}<small>%</small></>}
          </div>
          <div className="statcard-sub">
            {accuracy === null ? "No results yet" : `${correct} of ${resolved} correct`}
          </div>
        </div>
      </div>

      {/* Coin panel — only when a real Valve coin tier is visible (mockup 06) */}
      {coinTier && (
        <div className="coin-panel">
          <span className={`coin-sticker ${coinTier} coin-big`} />
          <div style={{ flex: 1 }}>
            <div className={`coin-tier-name ${coinTier}`}>{coinTier} Viewer Pass</div>
            <div className="coin-desc">{score} pts · mirrored from your Valve coin</div>
          </div>
        </div>
      )}

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
                const lockRevealed = arePicksRevealed(
                  group,
                  groupHasOutcome.has(groupOutcomeKey(section.sectionid, group.groupid)),
                  isLockTimePassed(section.sectionid, nowMs),
                );
                const revealed = isSelf || lockRevealed;
                const groupPicks = pickMap[section.sectionid]?.[group.groupid] ?? {};
                const groupOutcomes = outcomeMap[section.sectionid]?.[group.groupid] ?? {};

                return (
                  <div
                    key={group.groupid}
                    className="pickgroup"
                    style={{ marginBottom: 8 }}
                  >
                    <div className="pickgroup-head">
                      <span className="pickgroup-name" style={{ fontSize: 14 }}>
                        {group.name.split(" | ").slice(-1)[0]}
                      </span>
                      <span className="pickgroup-pts">
                        {group.points_per_pick} PT{group.points_per_pick !== 1 ? "S" : ""}/PICK
                      </span>
                    </div>

                    {!revealed ? (
                      <div style={{ padding: 20, textAlign: "center", color: "var(--ink-low)", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        🔒 Hidden until this stage locks
                      </div>
                    ) : (
                      <div style={{ padding: 14 }}>
                        <div className="pickcards">
                          {group.picks.map((slot) => {
                            const pick = groupPicks[slot.index];
                            const team = pick ? teamMap.get(pick) : null;
                            const winner = groupOutcomes[slot.index];
                            const hit = winner !== undefined && pick === winner;
                            const wrong = winner !== undefined && pick !== undefined && pick !== winner;
                            const typeLabel = bucketLabelFor(section.sectionid, group, slot.index);
                            // Consensus % stays gated on the LOCK (not isSelf): showing the
                            // field split while a stage is still open invites herd-following
                            // even on your own profile (PHA-889). Your pick still shows; only
                            // the % waits for lock — same discipline as the reveal gate.
                            const share = pick && lockRevealed
                              ? shareFor(consensus, section.sectionid, group.groupid, slot.index, pick)
                              : null;
                            return (
                              <div
                                key={slot.index}
                                className={`pickcard${hit ? " correct" : wrong ? " wrong" : ""}`}
                              >
                                {team ? (
                                  <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={44} />
                                ) : (
                                  <div style={{ width: 44, height: 44, display: "grid", placeItems: "center", color: "var(--ink-low)", fontFamily: "var(--font-mono)", fontSize: 18 }}>—</div>
                                )}
                                <span className="pickcard-team">{team ? team.name : "—"}</span>
                                <span className="pickcard-row">
                                  {typeLabel && <span className="pickcard-type">{typeLabel}</span>}
                                  {winner !== undefined && (
                                    <span className={`pickcard-icon ${hit ? "correct" : "wrong"}`}>
                                      {hit ? "✓" : "✗"}
                                    </span>
                                  )}
                                </span>
                                {share && (
                                  <span className="pickcard-share" title={`${share.count} of ${consensus.get(consensusKey(section.sectionid, group.groupid, slot.index))?.total ?? share.count} players`}>
                                    <b>{share.pct}%</b> of field
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
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
