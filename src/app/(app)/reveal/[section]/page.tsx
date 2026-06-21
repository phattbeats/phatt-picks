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
import { StageWrappedReplay, WrappedReplayOnLoad } from "@/components/heat/StageWrappedReplay";
import { stageWrappedKey } from "@/lib/stage-wrapped-core";
import { buildStageWrappedDeck, stageWrappedHasContent, type StageWrappedBestCall } from "@/lib/stage-wrapped-content";
import { isPlayoffSection, playoffRoundForSection, PLAYOFF_ROUNDS } from "@/lib/playoff-bracket-core";
import { majorWrappedStageKey } from "@/lib/stage-wrapped-launch";

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
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const EVENT_ID = currentEventId(); // per-request active event (PHA-1046)
  const { section: sectionParam } = await params;
  const sectionId = Number(sectionParam);
  if (!Number.isInteger(sectionId)) notFound();

  // ?wrapped=1 — arrived from the recap notification; force-open the cinematic
  // deck once even if this device already dismissed the auto-popup (PHA-1245).
  const sp = await searchParams;
  const wantsWrapped = sp.wrapped === "1";

  const layout = getCommittedLayout();
  const teamMap = buildTeamMap(layout);
  const sectionDef = layout.sections.find((s) => s.sectionid === sectionId);
  if (!sectionDef) notFound();

  // Visual assets for the Stage Wrapped deck (PHA-1054): team-logo cascade from
  // the same teamMap + manifest the reveal grid uses, plus the major + game
  // brand marks served from /public/watch.
  const wrappedAssets = {
    resolveTeamLogo: (pid: number) => {
      const t = teamMap.get(pid);
      return t ? { tiers: resolveLogoTiers(t), name: t.name } : null;
    },
    majorLogoSrc: "/watch/iem-cologne.png",
    gameLogoSrc: "/watch/counter-strike.png",
  };

  const session = await getSession();
  // Live driver (PHA-866): the issue names Stage Reveal explicitly — keep it fresh
  // for a direct first-viewer (deep link / push). Atomic claim shared with the
  // other surfaces, so this is a no-op within the 30s window.
  await refreshOutcomesOnRead(EVENT_ID);
  const stageLabel = sectionDef.name.split(" | ")[0];
  const stageIdx = layout.sections.findIndex((s) => s.sectionid === sectionId);

  // The playoffs are ONE bracket Pick'Em (QF→SF→GF), so their reveal is ONE
  // stage too — not three separate per-round reveals (Brandon: "playoffs should
  // be all one stage reveal"). When the requested section is any playoff round,
  // the reveal spans every playoff section: one "Playoffs" heading, the whole
  // bracket of picks, and a single score/rank-move across the run. Mirrors how
  // the picks page + home hero already consolidate 108/109/110 (PHA-1007/1204).
  const playoff = isPlayoffSection(sectionId);
  const groupSections = playoff
    ? PLAYOFF_ROUNDS.map((r) => layout.sections.find((s) => s.sectionid === r.sectionId)).filter(
        (s): s is Section => !!s,
      )
    : [sectionDef];
  const groupSectionIds = groupSections.map((s) => s.sectionid);
  const revealLabel = playoff ? "Playoffs" : stageLabel;
  const eyebrowText = playoff ? "PLAYOFFS" : `STAGE_REVEAL · ${String(stageIdx + 1).padStart(2, "0")}`;
  // The playoff reveal's recap IS the Major Wrapped deck (one bracket → one
  // cinematic), opened through the app-wide launcher's replay bus rather than a
  // per-round wrap. The per-round wrap ("Grand Final — nothing to wrap yet") is
  // what the old /reveal/110?wrapped=1 deep link wrongly surfaced (PHA-1274).
  const majorKey = majorWrappedStageKey(EVENT_ID);

  const [outcomes, allPicks] = await Promise.all([
    prisma.stageOutcome.findMany({ where: { eventId: EVENT_ID } }),
    prisma.pick.findMany({
      where: { eventId: EVENT_ID, sectionId: { in: groupSectionIds } },
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
  // Resolved if ANY section in the group has landed (a playoff reveal opens as
  // soon as the quarterfinals resolve, then fills in as SF/GF land).
  const groupResolved = groupSectionIds.some((id) => !!outcomeMap[id]);

  // Resolved-section history (from snapshots) → rank before/after this stage.
  // For a multi-round playoff group the "after" rank is the latest resolved
  // round and the "before" rank is whatever resolved just before the bracket
  // began, so the rank move spans the whole run, not a single round.
  const resolvedSections = await snapshotSectionIds(EVENT_ID);
  const resolvedInGroup = groupSectionIds.filter((id) => !!outcomeMap[id]);
  const afterAnchor = resolvedInGroup.length ? resolvedInGroup[resolvedInGroup.length - 1] : sectionId;
  const prevSection = previousResolvedSection(resolvedSections, groupSectionIds[0]);
  const [afterMap, beforeMap] = await Promise.all([
    rankMapForSection(EVENT_ID, afterAnchor),
    rankMapForSection(EVENT_ID, prevSection),
  ]);

  // Not resolved yet → honest empty state.
  if (!groupResolved) {
    return (
      <>
        <RevealEyebrow text={eyebrowText} />
        <h1 className="font-display" style={heroTitle}>{revealLabel}</h1>
        <div style={{ ...v3Card, textAlign: "center", padding: "40px 24px", marginTop: 16 }}>
          <p className="font-display" style={{ fontWeight: 700, fontSize: 20, textTransform: "uppercase", color: "var(--ink-hi)", margin: "0 0 6px" }}>
            {playoff ? "Playoffs not resolved yet" : "Stage not resolved yet"}
          </p>
          <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: 0 }}>
            The reveal drops as soon as {revealLabel} results land.{" "}
            <Link href="/leaderboard" style={{ color: "var(--heat)" }}>Back to standings</Link>.
          </p>
        </div>
      </>
    );
  }

  // Field popularity per (slot → pickId), counted across players who picked.
  type SlotStat = { winnerPickId: number; tag: string | null; total: number; correctCount: number; total_field: number };
  const slotStats: SlotStat[] = [];
  for (const sec of groupSections) {
    for (const group of sec.groups) {
      const gOut = outcomeMap[sec.sectionid]?.[group.groupid] ?? {};
      for (const slot of group.picks) {
        const winner = gOut[slot.index];
        if (winner === undefined) continue;
        const field = allPicks.filter(
          (p) => p.sectionId === sec.sectionid && p.groupId === group.groupid && p.slotIndex === slot.index && p.pickId !== 0,
        );
        const correctCount = field.filter((p) => p.pickId === winner).length;
        slotStats.push({
          winnerPickId: winner,
          tag: bucketLabelFor(sec.sectionid, group, slot.index),
          total: field.length,
          correctCount,
          total_field: field.length,
        });
      }
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
        {/* Recap (PHA-1054/1274). For a playoff round the recap is the Major
            Wrapped deck (the app-wide launcher already mounts it); ?wrapped=1
            just replays it. For a Swiss stage it's that stage's own deck,
            auto-opened once. Reached only on a resolved stage. */}
        {playoff ? (
          <WrappedReplayOnLoad stageKey={majorKey} active={wantsWrapped} />
        ) : (
          <StageWrappedAnnounce
            stageKey={stageWrappedKey(EVENT_ID, sectionId)}
            eventId={EVENT_ID}
            sectionId={sectionId}
            slides={buildStageWrappedDeck(sectionId, stageLabel, null, wrappedAssets)}
            title={stageLabel}
            resolved
            forceOpen={wantsWrapped}
          />
        )}
        <RevealEyebrow text={eyebrowText} />
        <h1 className="font-display" style={heroTitle}>{revealLabel}</h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "4px 0 0" }}>Stage Reveal · {afterMap.size} ranked</p>
        {leader && (
          <div style={{ ...v3Card, marginTop: 16 }}>
            <div style={{ ...v3CardLabel, color: "var(--ink-mid)" }}>Stage Leader</div>
            <Link href={`/players/${encodeURIComponent(leader.id)}`} className="font-display" style={{ fontSize: 24, fontWeight: 800, textTransform: "uppercase", color: "var(--ink-hi)", textDecoration: "none" }}>
              {leader.displayName}
            </Link>
          </div>
        )}
        <ConsensusPanel consensus={consensus} bold={bold} teamMap={teamMap} />
        <div style={{ ...v3Card, marginTop: 14 }}>
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

  // Score for THIS stage (the whole playoff group, when consolidated) only, and
  // cumulative total across all resolved stages.
  const stageOutcomes: OutcomeMap = {};
  for (const id of groupSectionIds) if (outcomeMap[id]) stageOutcomes[id] = outcomeMap[id];
  const groupBreaks = scorePlayer(layout, subjectPickMap, stageOutcomes).bySection.filter((b) =>
    groupSectionIds.includes(b.sectionId),
  );
  const stagePoints = groupBreaks.reduce((a, b) => a + b.points, 0);
  const correct = groupBreaks.reduce((a, b) => a + b.correct, 0);
  const totalPoints = scorePlayer(layout, subjectPickMap, outcomeMap).total;

  let resolvedSlots = 0;
  for (const sec of groupSections) {
    for (const g of sec.groups) {
      const gOut = outcomeMap[sec.sectionid]?.[g.groupid] ?? {};
      for (const slot of g.picks) if (gOut[slot.index] !== undefined) resolvedSlots++;
    }
  }

  const rankAfter = afterMap.get(subject.id) ?? null;
  const rankBefore = beforeMap.get(subject.id) ?? null;
  const delta = rankAfter != null ? rankDelta(rankAfter, rankBefore) : null;

  // Stage Wrapped "best call" (PHA-1054): among the viewer's CORRECT picks this
  // stage, the one the fewest of the field also nailed (their boldest right
  // read). Reuses the same bucket-correctness + slot-consensus the reveal grid
  // below already renders, so the recap agrees with the per-pick breakdown.
  let bestCall: StageWrappedBestCall | null = null;
  // The viewer's CORRECT calls as "<pickId>:<bucket>" — feeds the Stage Wrapped
  // "YOU CALLED IT" reward when a pick matched a narrative moment (PHA-1054).
  const viewerClaims = new Set<string>();
  for (const sec of groupSections) {
    for (const group of sec.groups) {
      const gOut = outcomeMap[sec.sectionid]?.[group.groupid] ?? {};
      const buckets = isSwissSection(sec.sectionid) ? bucketSwissSlots(group.picks.length) : null;
      for (const slot of group.picks) {
        const pickId = subjectPickMap[sec.sectionid]?.[group.groupid]?.[slot.index];
        if (pickId == null || pickId === 0) continue;
        const winner = gOut[slot.index];
        if (winner === undefined) continue;
        const bucket = buckets?.find((b) => b.slotIndexes.includes(slot.index)) ?? null;
        const isCorrect = bucket
          ? resolveBucketWinners(bucket.slotIndexes, gOut).winners.has(pickId)
          : pickId === winner;
        if (!isCorrect) continue;
        const claimTag = bucketLabelFor(sec.sectionid, group, slot.index);
        if (claimTag) viewerClaims.add(`${pickId}:${claimTag}`);
        const share = shareFor(slotConsensus, sec.sectionid, group.groupid, slot.index, pickId);
        const pct = share?.pct ?? 0;
        const count = share?.count ?? 0;
        const total = slotConsensus.get(consensusKey(sec.sectionid, group.groupid, slot.index))?.total ?? 0;
        if (bestCall === null || pct < bestCall.pct) {
          bestCall = {
            pickId,
            teamName: teamMap.get(pickId)?.name ?? `#${pickId}`,
            tag: bucketLabelFor(sec.sectionid, group, slot.index),
            pct,
            count,
            total,
          };
        }
      }
    }
  }

  return (
    <>
      {/* Recap (PHA-1054 / PHA-1051 / PHA-1274) — explicit-open only. The Swiss
          stage's own deck opens on the ?wrapped=1 deep link / "Replay" button;
          it never auto-pops (PHA-1269 froze low-end mobile on login). A playoff
          round instead replays the Major Wrapped deck the app-wide launcher
          already mounts — one bracket, one cinematic. */}
      {playoff ? (
        <WrappedReplayOnLoad stageKey={majorKey} active={wantsWrapped} />
      ) : (
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
            avatar: { src: subject.avatarUrl ?? null, label: subject.displayName },
            claims: [...viewerClaims],
          }, wrappedAssets)}
          title={stageLabel}
          resolved={false}
          forceOpen={wantsWrapped}
        />
      )}
      <RevealEyebrow text={eyebrowText} />
      <h1 className="font-display" style={heroTitle}>{revealLabel}</h1>
      <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "4px 0 0" }}>
        Stage Reveal · {subject.displayName}
      </p>

      {/* Score moment (mockup-08): this stage, rank move, cumulative total */}
      <div className="reveal-moment" style={{ marginTop: 16 }}>
        <MomentCard label="This Stage" value={`+${stagePoints}`} unit="pts" foil />
        <MomentCard
          label="Rank Move"
          custom={<RankMove delta={delta} rankAfter={rankAfter} rankBefore={rankBefore} />}
        />
        <MomentCard label="Total" value={String(totalPoints)} unit="pts" />
      </div>

      {/* Consensus / bold calls */}
      <ConsensusPanel consensus={consensus} bold={bold} teamMap={teamMap} />

      {/* Per-pick breakdown */}
      <div style={sectionHeader}>
        <span>How Your Picks Landed</span>
        <span style={{ color: "var(--heat)" }}>{correct}/{resolvedSlots}</span>
      </div>
      {groupSections.map((sec) => {
        // Swiss buckets are interchangeable: a pick is correct if its team
        // landed ANYWHERE in the bucket, not at its exact slot (PHA-946/918).
        // The clinch resolver fills winner rows in layout order, not pick
        // order, so per-slot comparison strikes correct picks as misses and
        // contradicts the set-based scorer in the header. Playoffs stay
        // per-slot. (PHA-1015)
        const round = playoff ? playoffRoundForSection(sec.sectionid) : null;
        const cards = sec.groups.flatMap((group) => {
          const gOut = outcomeMap[sec.sectionid]?.[group.groupid] ?? {};
          const buckets = isSwissSection(sec.sectionid) ? bucketSwissSlots(group.picks.length) : null;
          return group.picks.map((slot) => {
            const pickId = subjectPickMap[sec.sectionid]?.[group.groupid]?.[slot.index];
            const winner = gOut[slot.index];
            const team = pickId != null ? teamMap.get(pickId) : undefined;
            const tag = bucketLabelFor(sec.sectionid, group, slot.index);
            const resolved = winner !== undefined;
            const bucket = buckets?.find((b) => b.slotIndexes.includes(slot.index)) ?? null;
            const isCorrect = resolved && pickId != null && (
              bucket
                ? resolveBucketWinners(bucket.slotIndexes, gOut).winners.has(pickId)
                : pickId === winner
            );
            return (
              <div key={`${sec.sectionid}:${group.groupid}:${slot.index}`} style={{ display: "flex", flexDirection: "column" }}>
                <div className={`pickcard${resolved && isCorrect ? " is-correct" : ""}${resolved && !isCorrect ? " is-miss" : ""}`}>
                  {resolved && (
                    <span
                      className="pickcard-verdict"
                      style={{ color: isCorrect ? "var(--tac-green, #9bd23c)" : "var(--ember, #d8351c)" }}
                      aria-label={isCorrect ? "correct" : "missed"}
                    >
                      {isCorrect ? "✓" : "✗"}
                    </span>
                  )}
                  <div className="pickcard-logo">
                    {team && team.pickid !== 0 ? (
                      <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={128} />
                    ) : (
                      <div style={{ width: 128, height: 128, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-low)", fontFamily: "var(--font-mono)", fontSize: 48 }}>?</div>
                    )}
                  </div>
                  <div className="font-display pickcard-name" style={{ color: "var(--ink-hi)" }}>
                    {team?.name ?? "No pick"}
                  </div>
                  {tag && <div style={tagStyle}>{tag}</div>}
                </div>
                <ConsensusBar
                  consensus={slotConsensus.get(consensusKey(sec.sectionid, group.groupid, slot.index))}
                  teamMap={teamMap}
                  highlightPickId={pickId ?? undefined}
                  winnerPickId={winner}
                  max={3}
                />
              </div>
            );
          });
        });
        return (
          <div key={sec.sectionid}>
            {/* Round label only when the playoffs are consolidated — it splits
                the one bracket reveal into QF / SF / GF bands. */}
            {round && <div style={roundHeader}>{round.label}</div>}
            <div className="reveal-picks">{cards}</div>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
        <Link href="/leaderboard" className="btn-heat">
          View Standings
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </Link>
        <Link href={`/players/${encodeURIComponent(subject.id)}`} className="btn-ghost">Full profile</Link>
        {playoff ? (
          <StageWrappedReplay stageKey={majorKey} label="Watch the Wrapped recap" />
        ) : stageWrappedHasContent(sectionId) ? (
          <StageWrappedReplay stageKey={stageWrappedKey(EVENT_ID, sectionId)} />
        ) : null}
      </div>

      <style>{`
        /* v3 "Arcade → Broadcast" (PHA-1007): rounded surfaces with a single
           top keyline instead of four corner brackets, hairline-divided stat
           band, neutral warm-white hairlines. */
        .reveal-moment {
          display: grid; grid-template-columns: repeat(3, 1fr);
          background: linear-gradient(180deg, var(--surf-2) 0%, var(--surf-1) 100%);
          border: 1px solid rgba(245,234,212,0.08); border-radius: 14px; overflow: hidden;
          /* light sheen (PHA-1117): a faint specular line catches the top edge */
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .reveal-moment > div + div { border-left: 1px solid rgba(245,234,212,0.08); }
        /* logos are the focus (PHA-1117): wider cards, fewer columns, so each
           crest dominates its tile rather than floating in negative space. */
        .reveal-picks { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        @media (min-width: 720px) { .reveal-picks { grid-template-columns: repeat(3, 1fr); } }
        .pickcard {
          display: flex; flex-direction: column; align-items: center; text-align: center;
          gap: 10px; padding: 24px 14px 16px;
          border: 1px solid rgba(245,234,212,0.08); border-radius: 14px;
          background: linear-gradient(180deg, var(--surf-2) 0%, var(--surf-1) 100%);
          position: relative; overflow: hidden;
          /* light sheen (PHA-1117) */
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
          transition: transform 180ms var(--ease), box-shadow 180ms var(--ease), border-color 180ms var(--ease);
        }
        /* cool minimal thing (PHA-1117): the card you're reading lifts a hair on
           hover and the sheen warms — tactile, no perpetual motion. */
        @media (hover: hover) {
          .pickcard:hover { transform: translateY(-2px); box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 24px -16px rgba(0,0,0,0.7); border-color: rgba(245,234,212,0.16); }
        }
        .pickcard.is-correct { border-color: rgba(155,210,60,0.28); }
        .pickcard.is-correct::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
          background: linear-gradient(90deg, var(--tac-green, #9bd23c) 0%, rgba(155,210,60,0.25) 45%, transparent 80%);
        }
        .pickcard.is-miss { opacity: 0.82; }
        .pickcard-logo { display: flex; align-items: center; justify-content: center; min-height: 128px; }
        .pickcard-name {
          font-weight: 800; font-size: 19px; line-height: 1; letter-spacing: 0.01em;
          text-transform: uppercase; max-width: 100%;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .pickcard-verdict { position: absolute; top: 10px; right: 12px; font-size: 17px; font-weight: 700; line-height: 1; }
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

// v3 "Arcade → Broadcast" surface (PHA-1007): rounded, gradient, neutral
// hairline — no corner brackets. Shared by the reveal's secondary panels.
const v3Card = {
  position: "relative" as const,
  background: "linear-gradient(180deg, var(--surf-2) 0%, var(--surf-1) 100%)",
  border: "1px solid rgba(245,234,212,0.08)",
  borderRadius: 14,
  padding: "18px 22px",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)", // light sheen (PHA-1117)
};

const v3CardLabel = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  fontWeight: 600 as const,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  marginBottom: 10,
};

const sectionHeader = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  fontWeight: 600 as const,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "var(--ink-mid)",
  margin: "30px 0 12px",
  display: "flex",
  alignItems: "baseline" as const,
  justifyContent: "space-between" as const,
  gap: 12,
};

const tagStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  letterSpacing: "0.1em",
  color: "var(--ink-low)",
  textTransform: "uppercase" as const,
};

// Round band header (QUARTERFINALS / SEMIFINALS / GRAND FINAL) that splits the
// consolidated playoff reveal's pick grid into its three rounds (PHA-1274).
const roundHeader = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  fontWeight: 600 as const,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "var(--ink-mid)",
  margin: "22px 0 10px",
};

function RevealEyebrow({ text }: { text: string }) {
  // v3 broadcast direction (PHA-1007): mono overline loses the literal [ ].
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span className="eyebrow-mono" style={{ fontSize: 10.5, letterSpacing: "0.2em" }}>{text}</span>
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
    <div style={{ padding: "18px 14px", textAlign: "center" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-mid)", marginBottom: 8 }}>{label}</div>
      {custom ?? (
        <div className={"font-display" + (foil ? " foil" : "")} style={{ fontWeight: 800, fontSize: 42, lineHeight: 0.9, color: "var(--ink-hi)" }}>
          {value}
          {unit && <small style={{ fontSize: 16, color: "var(--ink-low)", fontWeight: 600 }}>{unit}</small>}
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
      <div className="font-display" style={{ fontWeight: 800, fontSize: 42, lineHeight: 0.9, color: "var(--ink-hi)" }}>
        {rankAfter != null ? (<>{rankAfter}<small style={{ fontSize: 15, color: "var(--ink-low)" }}>{ordSuffix(rankAfter)}</small></>) : "—"}
      </div>
    );
  }
  const moved = Math.abs(delta.delta ?? 0);
  const up = delta.direction === "up";
  const flat = delta.direction === "flat";
  const color = up ? "var(--tac-green, #9bd23c)" : flat ? "var(--ink-mid)" : "var(--ember, #d8351c)";
  return (
    <div className="font-display" style={{ fontWeight: 800, fontSize: 42, lineHeight: 0.9, color }} title={rankBefore != null ? `was ${rankBefore}${ordSuffix(rankBefore)}` : undefined}>
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
    <div className="reveal-insights" style={{ marginTop: 16 }}>
      <div className="insight-card insight-consensus">
        <div className="insight-head" style={{ color: "var(--heat)" }}>Consensus</div>
        <div className="insight-body">
          <div className="insight-logo">
            {cTeam && cTeam.pickid !== 0
              ? <TeamLogo tiers={resolveLogoTiers(cTeam)} teamName={cTeam.name} size={96} />
              : <div className="insight-logo-blank">#{consensus.winnerPickId}</div>}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="font-display insight-name" style={{ color: "var(--ink-hi)" }}>
              {cTeam?.name ?? `#${consensus.winnerPickId}`}{consensus.tag ? <span className="insight-tag"> {consensus.tag}</span> : null}
            </div>
            <div className="insight-meta">
              {consensus.correctCount}/{consensus.total_field} called it right
            </div>
          </div>
        </div>
      </div>
      {bTeam && bold && bold.correctCount > 0 && (
        <div className="insight-card insight-bold">
          <div className="insight-head" style={{ color: "var(--ember, #d8351c)" }}>Bold Call</div>
          <div className="insight-body">
            <div className="insight-logo">
              <TeamLogo tiers={resolveLogoTiers(bTeam)} teamName={bTeam.name} size={96} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="font-display insight-name" style={{ color: "var(--ink-hi)" }}>
                {bTeam.name}{bold.tag ? <span className="insight-tag"> {bold.tag}</span> : null}
              </div>
              <div className="insight-meta">
                only {bold.correctCount}/{bold.total_field} nailed it
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .reveal-insights { display: grid; grid-template-columns: 1fr; gap: 10px; }
        @media (min-width: 640px) { .reveal-insights { grid-template-columns: 1fr 1fr; } }
        /* v3 broadcast card: rounded, gradient surface, one top keyline (no
           corner brackets), neutral hairline. Accent keyed per card. */
        .insight-card {
          position: relative; overflow: hidden; padding: 18px 22px;
          background: linear-gradient(180deg, var(--surf-2) 0%, var(--surf-1) 100%);
          border: 1px solid rgba(245,234,212,0.08); border-radius: 14px;
          /* light sheen (PHA-1117): faint specular top edge */
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .insight-card::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; z-index: 2;
        }
        .insight-consensus::before { background: linear-gradient(90deg, var(--heat) 0%, rgba(240,163,0,0.25) 42%, transparent 78%); }
        .insight-bold::before { background: linear-gradient(90deg, var(--ember, #d8351c) 0%, rgba(216,53,28,0.22) 42%, transparent 78%); }
        /* cool minimal thing (PHA-1117): a single light sweep glides across the
           headline cards once on load — a broadcast lower-third wipe — then rests
           off-screen. The global prefers-reduced-motion kill switch parks it. */
        .insight-card::after {
          content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 55%; z-index: 1;
          background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.09) 50%, transparent 70%);
          transform: translateX(-130%);
          animation: rv-sheen-sweep 1.15s cubic-bezier(.22,.61,.36,1) 0.35s both;
          pointer-events: none;
        }
        .insight-bold::after { animation-delay: 0.5s; }
        @keyframes rv-sheen-sweep { from { transform: translateX(-130%); } to { transform: translateX(230%); } }
        .insight-head {
          font-family: var(--font-mono); font-size: 13px; font-weight: 600;
          letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 14px;
        }
        .insight-body { display: flex; align-items: center; gap: 16px; }
        .insight-logo { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 96px; height: 96px; }
        .insight-logo-blank { font-family: var(--font-mono); font-size: 13px; color: var(--ink-low); }
        .insight-name {
          font-weight: 800; font-size: 26px; line-height: 0.95; letter-spacing: 0.01em;
          text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .insight-tag { font-size: 14px; color: var(--ink-low); font-weight: 700; }
        .insight-meta { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-mid); margin-top: 5px; }
      `}</style>
    </div>
  );
}
