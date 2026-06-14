/**
 * Stage Reveal (mockup-08, PHA-858) — a standalone post-stage screen.
 *
 * Once a stage resolves we freeze a RankSnapshot (see rank-snapshot.ts); this
 * page reads it back and pairs it with the resolved outcomes to tell a player
 * how the stage went:
 *   - Score moment: points earned this stage, rank move (▲/▼), cumulative total.
 *   - How your picks landed: per-slot ✓/✗ against the official result.
 *   - Stage consensus: field-wide popularity of each resolved call.
 *
 * Self-focused: signed-in players see their own reveal. Signed-out visitors get
 * the field summary (stage leader + consensus) and a sign-in prompt. A stage
 * that hasn't resolved yet shows an honest empty state rather than fabricated
 * data — the same no-leak discipline as reveal-core (results only after lock).
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { getSession } from "@/lib/session";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import { bucketSwissSlots, isSwissSection, resolveBucketWinners } from "@/lib/swiss-bucket-core";
import { rankMapForSection, snapshotSectionIds } from "@/lib/rank-snapshot";
import { previousResolvedSection, rankDelta } from "@/lib/rank-snapshot-core";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { buildConsensus, consensusKey, shareFor } from "@/lib/consensus-core";
import { ConsensusBar } from "@/components/heat/ConsensusBar";
import type { Section } from "@/lib/layout";
import { currentEventId } from "@/lib/events-core";
import { StageWrappedAnnounce } from "@/components/heat/StageWrapped";
import { StageWrappedReplay } from "@/components/heat/StageWrappedReplay";
import { stageWrappedKey } from "@/lib/stage-wrapped-core";
import { buildStageWrappedDeck, stageWrappedHasContent, type StageWrappedBestCall } from "@/lib/stage-wrapped-content";

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

/** Short pick-type tag for a Swiss slot (3:0 / 3:1·3:2 / 0:3). */
function bucketLabelFor(sectionId: number, group: Section["groups"][number], slotIndex: number): string | null {
  if (!isSwissSection(sectionId)) return null;
  const buckets = bucketSwissSlots(group.picks.length);
  const hit = buckets.find((b) => b.slotIndexes.includes(slotIndex));
  if (!hit || hit.label === "PICKS") return null;
  return hit.label.replace(" ADVANCED", "").replace(" ELIMINATED", "");
}

export default async function StageRevealPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const EVENT_ID = currentEventId(); // per-request active event (PHA-1046)
  const { section: sectionParam } = await params;
  const sectionId = Number(sectionParam);
  if (!Number.isInteger(sectionId)) notFound();

  const layout = getCommittedLayout();
  const teamMap = buildTeamMap(layout);
  const sectionDef = layout.sections.find((s) => s.sectionid === sectionId);
  if (!sectionDef) notFound();

  const session = await getSession();
  // Live driver (PHA-866): the issue names Stage Reveal explicitly — keep it fresh
  // for a direct first-viewer (deep link / push). Atomic claim shared with the
  // other surfaces, so this is a no-op within the 30s window.
  await refreshOutcomesOnRead(EVENT_ID);
  const stageLabel = sectionDef.name.split(" | ")[0];
  const stageIdx = layout.sections.findIndex((s) => s.sectionid === sectionId);

  const [outcomes, allPicks] = await Promise.all([
    prisma.stageOutcome.findMany({ where: { eventId: EVENT_ID } }),
    prisma.pick.findMany({
      where: { eventId: EVENT_ID, sectionId },
      select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
  ]);

  // Field-wide pick distribution per slot (PHA-889). The reveal page only ever
  // renders picks for a RESOLVED section, so showing the split here is post-lock
  // by construction — no herd-following while picks are open.
  const slotConsensus = buildConsensus(allPicks);

  const outcomeMap: OutcomeMap = {};
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }
  const sectionResolved = !!outcomeMap[sectionId];

  // Resolved-section history (from snapshots) → rank before/after this stage.
  const resolvedSections = await snapshotSectionIds(EVENT_ID);
  const prevSection = previousResolvedSection(resolvedSections, sectionId);
  const [afterMap, beforeMap] = await Promise.all([
    rankMapForSection(EVENT_ID, sectionId),
    rankMapForSection(EVENT_ID, prevSection),
  ]);

  // Not resolved yet → honest empty state.
  if (!sectionResolved) {
    return (
      <>
        <RevealEyebrow stageIdx={stageIdx} />
        <h1 className="font-display" style={heroTitle}>{stageLabel}</h1>
        <div className="panel brk" style={{ textAlign: "center", padding: "40px 24px", marginTop: 16 }}>
          <span className="br-tr" />
          <span className="br-bl" />
          <p className="font-display" style={{ fontWeight: 700, fontSize: 20, textTransform: "uppercase", color: "var(--ink-hi)", margin: "0 0 6px" }}>
            Stage not resolved yet
          </p>
          <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: 0 }}>
            The reveal drops as soon as {stageLabel} results land.{" "}
            <Link href="/leaderboard" style={{ color: "var(--heat)" }}>Back to standings</Link>.
          </p>
        </div>
      </>
    );
  }

  // Field popularity per (slot → pickId), counted across players who picked.
  type SlotStat = { winnerPickId: number; tag: string | null; total: number; correctCount: number; total_field: number };
  const slotStats: SlotStat[] = [];
  for (const group of sectionDef.groups) {
    const gOut = outcomeMap[sectionId]?.[group.groupid] ?? {};
    for (const slot of group.picks) {
      const winner = gOut[slot.index];
      if (winner === undefined) continue;
      const field = allPicks.filter((p) => p.groupId === group.groupid && p.slotIndex === slot.index && p.pickId !== 0);
      const correctCount = field.filter((p) => p.pickId === winner).length;
      slotStats.push({
        winnerPickId: winner,
        tag: bucketLabelFor(sectionId, group, slot.index),
        total: field.length,
        correctCount,
        total_field: field.length,
      });
    }
  }
  // Consensus = correct call the most players landed; Bold = correct call the
  // fewest landed (contrarian-right). Both over the field that actually picked.
  const correctStats = slotStats.filter((s) => s.total_field > 0).sort((a, b) => b.correctCount - a.correctCount);
  const consensus = correctStats[0] ?? null;
  const bold = correctStats.length > 1 ? correctStats[correctStats.length - 1] : null;

  const subject = session
    ? await prisma.player.findUnique({ where: { id: session.playerId } })
    : null;

  // Signed-out (or unknown player) → field summary + sign-in prompt.
  if (!subject) {
    const leaderId = [...afterMap.entries()].find(([, r]) => r === 1)?.[0] ?? null;
    const leader = leaderId ? await prisma.player.findUnique({ where: { id: leaderId } }) : null;
    return (
      <>
        {/* Stage Wrapped recap (PHA-1054) — auto-opens once per stage. Signed-out
            visitors get the stage's moments + a sign-in outro, no personal slides.
            Reached only on a resolved stage (we returned above when unresolved). */}
        <StageWrappedAnnounce
          stageKey={stageWrappedKey(EVENT_ID, sectionId)}
          eventId={EVENT_ID}
          sectionId={sectionId}
          slides={buildStageWrappedDeck(sectionId, stageLabel, null)}
          title={stageLabel}
          resolved
        />
        <RevealEyebrow stageIdx={stageIdx} />
        <h1 className="font-display" style={heroTitle}>{stageLabel}</h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "4px 0 0" }}>Stage Reveal · {afterMap.size} ranked</p>
        {leader && (
          <div className="panel brk" style={{ marginTop: 16 }}>
            <span className="br-tr" />
            <span className="br-bl" />
            <div className="panel-title">[ Stage Leader ]</div>
            <Link href={`/players/${encodeURIComponent(leader.id)}`} style={{ fontSize: 18, fontWeight: 600, color: "var(--ink-hi)", textDecoration: "none" }}>
              {leader.displayName}
            </Link>
          </div>
        )}
        <ConsensusPanel consensus={consensus} bold={bold} teamMap={teamMap} />
        <div className="panel brk" style={{ marginTop: 14, background: "rgba(240,163,0,0.04)", borderColor: "var(--hair-3)" }}>
          <span className="br-tr" />
          <span className="br-bl" />
          <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: 0 }}>
            <Link href="/login/auth" style={{ color: "var(--heat)" }}>Sign in</Link> to see your personal Stage Reveal — your score, rank move, and how every pick landed.
          </p>
        </div>
      </>
    );
  }

  // Personal reveal.
  const subjectPicks = await prisma.pick.findMany({
    where: { eventId: EVENT_ID, playerId: subject.id },
  });
  const subjectPickMap: PlayerPickMap[string] = {};
  for (const p of subjectPicks) {
    subjectPickMap[p.sectionId] ??= {};
    subjectPickMap[p.sectionId][p.groupId] ??= {};
    subjectPickMap[p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }

  // Score for THIS stage only, and cumulative total across all resolved stages.
  const stageOutcomes: OutcomeMap = outcomeMap[sectionId] ? { [sectionId]: outcomeMap[sectionId] } : {};
  const stageBreak = scorePlayer(layout, subjectPickMap, stageOutcomes).bySection.find((b) => b.sectionId === sectionId);
  const stagePoints = stageBreak?.points ?? 0;
  const correct = stageBreak?.correct ?? 0;
  const totalPoints = scorePlayer(layout, subjectPickMap, outcomeMap).total;

  let resolvedSlots = 0;
  for (const g of sectionDef.groups) {
    const gOut = outcomeMap[sectionId]?.[g.groupid] ?? {};
    for (const slot of g.picks) if (gOut[slot.index] !== undefined) resolvedSlots++;
  }

  const rankAfter = afterMap.get(subject.id) ?? null;
  const rankBefore = beforeMap.get(subject.id) ?? null;
  const delta = rankAfter != null ? rankDelta(rankAfter, rankBefore) : null;

  // Stage Wrapped "best call" (PHA-1054): among the viewer's CORRECT picks this
  // stage, the one the fewest of the field also nailed (their boldest right
  // read). Reuses the same bucket-correctness + slot-consensus the reveal grid
  // below already renders, so the recap agrees with the per-pick breakdown.
  let bestCall: StageWrappedBestCall | null = null;
  for (const group of sectionDef.groups) {
    const gOut = outcomeMap[sectionId]?.[group.groupid] ?? {};
    const buckets = isSwissSection(sectionId) ? bucketSwissSlots(group.picks.length) : null;
    for (const slot of group.picks) {
      const pickId = subjectPickMap[sectionId]?.[group.groupid]?.[slot.index];
      if (pickId == null || pickId === 0) continue;
      const winner = gOut[slot.index];
      if (winner === undefined) continue;
      const bucket = buckets?.find((b) => b.slotIndexes.includes(slot.index)) ?? null;
      const isCorrect = bucket
        ? resolveBucketWinners(bucket.slotIndexes, gOut).winners.has(pickId)
        : pickId === winner;
      if (!isCorrect) continue;
      const share = shareFor(slotConsensus, sectionId, group.groupid, slot.index, pickId);
      const pct = share?.pct ?? 0;
      const count = share?.count ?? 0;
      const total = slotConsensus.get(consensusKey(sectionId, group.groupid, slot.index))?.total ?? 0;
      if (bestCall === null || pct < bestCall.pct) {
        bestCall = {
          teamName: teamMap.get(pickId)?.name ?? `#${pickId}`,
          tag: bucketLabelFor(sectionId, group, slot.index),
          pct,
          count,
          total,
        };
      }
    }
  }

  return (
    <>
      {/* Stage Wrapped recap (PHA-1054) — auto-opens once per stage from the
          resolved-stage reveal, reusing the score / rank-move / best-call data
          computed above. Gated by `resolved` so it never leaks before lock. */}
      <StageWrappedAnnounce
        stageKey={stageWrappedKey(EVENT_ID, sectionId)}
        eventId={EVENT_ID}
        sectionId={sectionId}
        slides={buildStageWrappedDeck(sectionId, stageLabel, {
          displayName: subject.displayName,
          stagePoints,
          correct,
          resolvedSlots,
          totalPoints,
          rankAfter,
          rankMove: delta,
          bestCall,
        })}
        title={stageLabel}
        resolved
      />
      <RevealEyebrow stageIdx={stageIdx} />
      <h1 className="font-display" style={heroTitle}>{stageLabel}</h1>
      <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "4px 0 0" }}>
        Stage Reveal · {subject.displayName}
      </p>

      {/* Score moment (mockup-08): this stage, rank move, cumulative total */}
      <div className="reveal-moment" style={{ marginTop: 16 }}>
        <MomentCard label="[ This Stage ]" value={`+${stagePoints}`} unit="pts" foil />
        <MomentCard
          label="[ Rank Move ]"
          custom={<RankMove delta={delta} rankAfter={rankAfter} rankBefore={rankBefore} />}
        />
        <MomentCard label="[ Total ]" value={String(totalPoints)} unit="pts" />
      </div>

      {/* Consensus / bold calls */}
      <ConsensusPanel consensus={consensus} bold={bold} teamMap={teamMap} />

      {/* Per-pick breakdown */}
      <div className="section-label" style={sectionLabel}>How Your Picks Landed · {correct}/{resolvedSlots}</div>
      <div className="reveal-picks">
        {sectionDef.groups.flatMap((group) => {
          // Swiss buckets are interchangeable: a pick is correct if its team
          // landed ANYWHERE in the bucket, not at its exact slot (PHA-946/918).
          // The clinch resolver fills winner rows in layout order, not pick
          // order, so per-slot comparison strikes correct picks as misses and
          // contradicts the set-based scorer in the header. Playoffs stay
          // per-slot. (PHA-1015)
          const gOut = outcomeMap[sectionId]?.[group.groupid] ?? {};
          const buckets = isSwissSection(sectionId) ? bucketSwissSlots(group.picks.length) : null;
          return group.picks.map((slot) => {
            const pickId = subjectPickMap[sectionId]?.[group.groupid]?.[slot.index];
            const winner = gOut[slot.index];
            const team = pickId != null ? teamMap.get(pickId) : undefined;
            const tag = bucketLabelFor(sectionId, group, slot.index);
            const resolved = winner !== undefined;
            const bucket = buckets?.find((b) => b.slotIndexes.includes(slot.index)) ?? null;
            const isCorrect = resolved && pickId != null && (
              bucket
                ? resolveBucketWinners(bucket.slotIndexes, gOut).winners.has(pickId)
                : pickId === winner
            );
            return (
              <div key={`${group.groupid}:${slot.index}`} style={{ display: "flex", flexDirection: "column" }}>
                <div
                  className="pickcard brk"
                  style={{
                    borderColor: resolved ? (isCorrect ? "var(--hair-3)" : "var(--hair-2)") : "var(--hair)",
                    background: resolved && isCorrect ? "rgba(240,163,0,0.06)" : "var(--surf-1)",
                  }}
                >
                  {team && team.pickid !== 0 ? (
                    <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={40} />
                  ) : (
                    <div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-low)", fontFamily: "var(--font-mono)" }}>?</div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-hi)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {team?.name ?? "No pick"}
                    </div>
                    {tag && <div style={tagStyle}>{tag}</div>}
                  </div>
                  {resolved && (
                    <span style={{ fontSize: 16, fontWeight: 700, color: isCorrect ? "var(--tac-green, #9bd23c)" : "var(--ember, #d8351c)" }}>
                      {isCorrect ? "✓" : "✗"}
                    </span>
                  )}
                </div>
                <ConsensusBar
                  consensus={slotConsensus.get(consensusKey(sectionId, group.groupid, slot.index))}
                  teamMap={teamMap}
                  highlightPickId={pickId ?? undefined}
                  winnerPickId={winner}
                  max={3}
                />
              </div>
            );
          });
        })}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
        <Link href="/leaderboard" className="btn-heat">
          View Standings
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </Link>
        <Link href={`/players/${encodeURIComponent(subject.id)}`} className="btn-ghost">Full profile</Link>
        {stageWrappedHasContent(sectionId) && (
          <StageWrappedReplay stageKey={stageWrappedKey(EVENT_ID, sectionId)} />
        )}
      </div>

      <style>{`
        .reveal-moment { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--hair-2); border: 1px solid var(--hair-2); }
        .reveal-moment > div { background: var(--surf-1); }
        .reveal-picks { display: grid; grid-template-columns: 1fr; gap: 8px; }
        @media (min-width: 640px) { .reveal-picks { grid-template-columns: 1fr 1fr; } }
        .pickcard { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--hair); position: relative; }
      `}</style>
    </>
  );
}

const heroTitle = {
  fontWeight: 800 as const,
  fontSize: "clamp(30px, 5vw, 44px)",
  textTransform: "uppercase" as const,
  lineHeight: 0.95,
  margin: "8px 0 0",
};

const sectionLabel = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.16em",
  textTransform: "uppercase" as const,
  color: "var(--ink-low)",
  margin: "20px 0 8px",
};

const tagStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.08em",
  color: "var(--ink-low)",
  textTransform: "uppercase" as const,
};

function RevealEyebrow({ stageIdx }: { stageIdx: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span className="eyebrow-mono">[ STAGE_REVEAL · {String(stageIdx + 1).padStart(2, "0")} ]</span>
    </div>
  );
}

function MomentCard({
  label,
  value,
  unit,
  foil,
  custom,
}: {
  label: string;
  value?: string;
  unit?: string;
  foil?: boolean;
  custom?: ReactNode;
}) {
  return (
    <div style={{ padding: "16px 14px", textAlign: "center" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-low)", marginBottom: 6 }}>{label}</div>
      {custom ?? (
        <div className={"font-display" + (foil ? " foil" : "")} style={{ fontWeight: 800, fontSize: 36, lineHeight: 0.9, color: "var(--ink-hi)" }}>
          {value}
          {unit && <small style={{ fontSize: 15, color: "var(--ink-low)", fontWeight: 600 }}>{unit}</small>}
        </div>
      )}
    </div>
  );
}

function RankMove({
  delta,
  rankAfter,
  rankBefore,
}: {
  delta: { delta: number | null; direction: "up" | "down" | "flat" | "new" } | null;
  rankAfter: number | null;
  rankBefore: number | null;
}) {
  if (!delta || delta.direction === "new") {
    return (
      <div className="font-display" style={{ fontWeight: 800, fontSize: 36, lineHeight: 0.9, color: "var(--ink-hi)" }}>
        {rankAfter != null ? (<>{rankAfter}<small style={{ fontSize: 15, color: "var(--ink-low)" }}>{ordSuffix(rankAfter)}</small></>) : "—"}
      </div>
    );
  }
  const moved = Math.abs(delta.delta ?? 0);
  const up = delta.direction === "up";
  const flat = delta.direction === "flat";
  const color = up ? "var(--tac-green, #9bd23c)" : flat ? "var(--ink-mid)" : "var(--ember, #d8351c)";
  return (
    <div className="font-display" style={{ fontWeight: 800, fontSize: 36, lineHeight: 0.9, color }} title={rankBefore != null ? `was ${rankBefore}${ordSuffix(rankBefore)}` : undefined}>
      {flat ? "—" : (up ? "▲" : "▼")}{!flat && moved}
    </div>
  );
}

function ConsensusPanel({
  consensus,
  bold,
  teamMap,
}: {
  consensus: { winnerPickId: number; tag: string | null; correctCount: number; total_field: number } | null;
  bold: { winnerPickId: number; tag: string | null; correctCount: number; total_field: number } | null;
  teamMap: Map<number, { pickid: number; logo: string; name: string }>;
}) {
  if (!consensus) return null;
  const cTeam = teamMap.get(consensus.winnerPickId);
  const bTeam = bold ? teamMap.get(bold.winnerPickId) : null;
  return (
    <div className="reveal-insights" style={{ marginTop: 14 }}>
      <div className="panel brk" style={{ background: "rgba(240,163,0,0.04)", borderColor: "var(--hair-3)" }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <div className="panel-title" style={{ color: "var(--heat)" }}>[ Consensus ]</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-hi)" }}>
          {cTeam?.name ?? `#${consensus.winnerPickId}`}{consensus.tag ? ` (${consensus.tag})` : ""}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-low)", marginTop: 2 }}>
          {consensus.correctCount}/{consensus.total_field} called it right
        </div>
      </div>
      {bTeam && bold && bold.correctCount > 0 && (
        <div className="panel brk" style={{ borderColor: "rgba(216,53,28,0.25)" }}>
          <span className="br-tr" />
          <span className="br-bl" />
          <div className="panel-title" style={{ color: "var(--ember, #d8351c)" }}>[ Bold Call ]</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-hi)" }}>
            {bTeam.name}{bold.tag ? ` (${bold.tag})` : ""}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-low)", marginTop: 2 }}>
            only {bold.correctCount}/{bold.total_field} nailed it
          </div>
        </div>
      )}
      <style>{`
        .reveal-insights { display: grid; grid-template-columns: 1fr; gap: 8px; }
        @media (min-width: 640px) { .reveal-insights { grid-template-columns: 1fr 1fr; } }
      `}</style>
    </div>
  );
}
