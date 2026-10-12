/**
 * Stage Reveal (mockup-08 / Singapore 12, #858) — a standalone post-stage screen.
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
 *
 * Which Major: `?major=<slug>` / `?event=<id>` when given; otherwise the live
 * Major — unless the live Major has no layout fixture yet, in which case the
 * section ids in the URL belong to the committed layout's Major, so that's the
 * one read (keeps a previous Major's reveals + recap links working).
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCommittedLayout, buildTeamMap, type TeamDef } from "@/lib/layout";
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
import { currentEventId, getEventConfig } from "@/lib/events-core";
import { StageWrappedAnnounce } from "@/components/heat/StageWrapped";
import { StageWrappedReplay, WrappedReplayOnLoad } from "@/components/heat/StageWrappedReplay";
import { StageWrappedGate } from "@/components/heat/StageWrappedGate";
import { stageWrappedKey } from "@/lib/stage-wrapped-core";
import { buildStageWrappedDeck, stageWrappedHasContent, type StageWrappedBestCall } from "@/lib/stage-wrapped-content";
import { isPlayoffSection, playoffRoundForSection, PLAYOFF_ROUNDS } from "@/lib/playoff-bracket-core";
import { majorWrappedStageKey } from "@/lib/stage-wrapped-launch";
import { majorShortName, ordSuffix, requestedEvent } from "@/components/sg/people/people-data";

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
  const { section: sectionParam } = await params;
  const sectionId = Number(sectionParam);
  if (!Number.isInteger(sectionId)) notFound();

  // ?wrapped=1 — arrived from the recap notification; force-open the cinematic
  // deck once even if this device already dismissed the auto-popup (#1245).
  const sp = await searchParams;
  const wantsWrapped = sp.wrapped === "1";

  const layout = getCommittedLayout();
  const liveId = currentEventId(); // per-request active event (#1046)
  const asked = requestedEvent(sp);
  const EVENT_ID =
    asked?.eventId ?? (layout.event !== liveId && getEventConfig(layout.event) ? layout.event : liveId);
  const eventCfg = getEventConfig(EVENT_ID);
  const isLiveEvent = EVENT_ID === liveId;
  const majorQ = isLiveEvent || !eventCfg ? "" : `?major=${encodeURIComponent(eventCfg.slug)}`;

  const teamMap = buildTeamMap(layout);
  const sectionDef = layout.sections.find((s) => s.sectionid === sectionId);
  if (!sectionDef) notFound();

  // Visual assets for the Stage Wrapped deck (#1054): team-logo cascade from
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
  // Live driver (#866): the issue names Stage Reveal explicitly — keep it fresh
  // for a direct first-viewer (deep link / push). Atomic claim shared with the
  // other surfaces, so this is a no-op within the 30s window (and once frozen).
  await refreshOutcomesOnRead(EVENT_ID);
  const stageLabel = sectionDef.name.split(" | ")[0];

  // The playoffs are ONE bracket Pick'Em (QF→SF→GF), so their reveal is ONE
  // stage too — not three separate per-round reveals (Brandon: "playoffs should
  // be all one stage reveal"). When the requested section is any playoff round,
  // the reveal spans every playoff section: one "Playoffs" heading, the whole
  // bracket of picks, and a single score/rank-move across the run. Mirrors how
  // the picks page + home hero already consolidate 108/109/110 (#1007/1204).
  const playoff = isPlayoffSection(sectionId);
  const groupSections = playoff
    ? PLAYOFF_ROUNDS.map((r) => layout.sections.find((s) => s.sectionid === r.sectionId)).filter(
        (s): s is Section => !!s,
      )
    : [sectionDef];
  const groupSectionIds = groupSections.map((s) => s.sectionid);
  const revealLabel = playoff ? "Playoffs" : stageLabel;
  const eventShort = eventCfg ? majorShortName(eventCfg) : "";
  const numeral = stageLabel.replace(/^Stage\s+/i, "");
  const eyebrow = playoff ? (
    <>Playoffs · <b>{eventShort}</b> · results in</>
  ) : (
    <>Stage <b>{numeral}</b> · results in · picks public{!isLiveEvent && eventShort ? ` · ${eventShort}` : ""}</>
  );
  const heroPhoto = playoff ? "/wrapped/major-champion.jpg" : "/wrapped/major-woxic.jpg";
  // The playoff reveal's recap IS the Major Wrapped deck (one bracket → one
  // cinematic), opened through the app-wide launcher's replay bus rather than a
  // per-round wrap. The per-round wrap ("Grand Final — nothing to wrap yet") is
  // what the old /reveal/110?wrapped=1 deep link wrongly surfaced (#1274).
  const majorKey = majorWrappedStageKey(EVENT_ID);

  // The app-wide launcher only mounts the LIVE Major's deck. A previous Major's
  // playoff reveal mounts its own (replay-only, never auto-opens) so its
  // Wrapped stays watchable after the next Major takes over.
  const majorDeck = playoff && !isLiveEvent ? (
    <StageWrappedGate playerId={session?.playerId ?? null} eventId={EVENT_ID} autoOpen={false} forceOpen={wantsWrapped} />
  ) : null;

  const [outcomes, allPicks] = await Promise.all([
    prisma.stageOutcome.findMany({ where: { eventId: EVENT_ID } }),
    prisma.pick.findMany({
      where: { eventId: EVENT_ID, sectionId: { in: groupSectionIds } },
      select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
  ]);

  // Field-wide pick distribution per slot (#889). The reveal page only ever
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

  const hero = (title: React.ReactNode, extra?: React.ReactNode, tall = true) => (
    <section className={`bleed pp-rv${tall ? " tall" : " short"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={heroPhoto} alt="" />
      <span className="credit">Photo · HLTV</span>
      <div className="in">
        <span className="eyebrow rise">{eyebrow}</span>
        <h1 className="display rise d1">{title}</h1>
        {extra}
      </div>
    </section>
  );

  // Not resolved yet → honest empty state.
  if (!groupResolved) {
    return (
      <div className="pp-page">
        {majorDeck}
        {hero(revealLabel, <p className="rise d2">The reveal drops as soon as <b>{revealLabel}</b> results land.</p>, false)}
        <section className="chap">
          <div className="chap-h">
            <h2>{playoff ? "Playoffs not resolved yet" : "Stage not resolved yet"}</h2>
            <p>
              Picks, points and the room&apos;s calls appear here once the games are in.{" "}
              <Link href={`/leaderboard${majorQ}`} prefetch={false}>Back to standings</Link>.
            </p>
          </div>
        </section>
      </div>
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
  // Consensus = correct calls the most players landed; Bold = correct calls the
  // fewest landed (contrarian-right). Both over the field that actually picked.
  const correctStats = slotStats.filter((s) => s.total_field > 0).sort((a, b) => b.correctCount - a.correctCount);
  const consensusCalls = correctStats.filter((s) => s.correctCount > 0).slice(0, 3);
  const boldCalls =
    correctStats.length > 1
      ? [...correctStats]
          .reverse()
          .filter((s) => s.correctCount > 0 && !consensusCalls.includes(s))
          .slice(0, 3)
      : [];

  const subject = session
    ? await prisma.player.findUnique({ where: { id: session.playerId } })
    : null;

  // Signed-out (or unknown player) → field summary + sign-in prompt.
  if (!subject) {
    const leaderId = [...afterMap.entries()].find(([, r]) => r === 1)?.[0] ?? null;
    const leader = leaderId ? await prisma.player.findUnique({ where: { id: leaderId } }) : null;
    return (
      <div className="pp-page">
        {/* Recap (#1054/1274). For a playoff round the recap is the Major
            Wrapped deck (the app-wide launcher already mounts it); ?wrapped=1
            just replays it. For a Swiss stage it's that stage's own deck,
            opened on explicit intent. Reached only on a resolved stage. */}
        {majorDeck}
        {playoff ? (
          isLiveEvent && <WrappedReplayOnLoad stageKey={majorKey} active={wantsWrapped} />
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
        {hero(
          <>{revealLabel},<br />called.</>,
          <p className="rise d2"><b>{afterMap.size} players</b> ranked after {revealLabel}.</p>,
        )}
        {leader && (
          <section className="chap">
            <div className="chap-h row2">
              <div>
                <span className="n">Stage leader</span>
                <h2>{leader.displayName} leads</h2>
              </div>
              <Link className="btn-ghost" href={`/players/${encodeURIComponent(leader.id)}${majorQ}`} prefetch={false}>
                See their picks
              </Link>
            </div>
          </section>
        )}
        <RoomCalls consensus={consensusCalls} bold={boldCalls} teamMap={teamMap} />
        <section className="chap">
          <div className="chap-h">
            <h2>Your reveal is waiting</h2>
            <p>
              <Link href="/login" prefetch={false}>Sign in</Link> to see your score, your rank move and{" "}
              <b>how every pick landed.</b>
            </p>
          </div>
        </section>
      </div>
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

  // Stage Wrapped "best call" (#1054): among the viewer's CORRECT picks this
  // stage, the one the fewest of the field also nailed (their boldest right
  // read). Reuses the same bucket-correctness + slot-consensus the reveal grid
  // below already renders, so the recap agrees with the per-pick breakdown.
  let bestCall: StageWrappedBestCall | null = null;
  // The viewer's CORRECT calls as "<pickId>:<bucket>" — feeds the Stage Wrapped
  // "YOU CALLED IT" reward when a pick matched a narrative moment (#1054).
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

  const missed = resolvedSlots - correct;
  const picksHead =
    resolvedSlots === 0
      ? "Calls still in play"
      : missed === 0
        ? `${correct} for ${correct}`
        : correct === 0
          ? `${missed} burned`
          : `${correct} right, ${missed} burned`;

  return (
    <div className="pp-page">
      {/* Recap (#1054 / #1051 / #1274) — explicit-open only. The Swiss
          stage's own deck opens on the ?wrapped=1 deep link / "Replay" button;
          it never auto-pops (#1269 froze low-end mobile on login). A playoff
          round instead replays the Major Wrapped deck the app-wide launcher
          already mounts — one bracket, one cinematic. */}
      {majorDeck}
      {playoff ? (
        isLiveEvent && <WrappedReplayOnLoad stageKey={majorKey} active={wantsWrapped} />
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

      {/* Score moment: this stage, rank (with its move), cumulative total */}
      {hero(
        <>{revealLabel},<br />called.</>,
        <div className="pp-score rise d2" aria-label={`Stage reveal for ${subject.displayName}`}>
          <div>
            <div className="k">You scored</div>
            <div className="v">+{stagePoints}</div>
          </div>
          <div>
            <div className="k">Rank</div>
            <div className="v">
              {rankAfter != null ? String(rankAfter).padStart(2, "0") : "—"}
              <RankMove delta={delta} rankBefore={rankBefore} />
            </div>
          </div>
          <div>
            <div className="k">Total</div>
            <div className="v foil">{totalPoints}</div>
          </div>
        </div>,
      )}

      {/* Per-pick breakdown */}
      <section className="chap">
        <div className="chap-h">
          <span className="n">How your picks landed · {correct}/{resolvedSlots}</span>
          <h2>{picksHead}</h2>
          <p>
            <b>{correct} of {resolvedSlots}</b> resolved calls landed for <b>+{stagePoints} points</b>.
          </p>
        </div>
        {groupSections.map((sec) => {
          // Swiss buckets are interchangeable: a pick is correct if its team
          // landed ANYWHERE in the bucket, not at its exact slot (#946/918).
          // The clinch resolver fills winner rows in layout order, not pick
          // order, so per-slot comparison strikes correct picks as misses and
          // contradicts the set-based scorer in the header. Playoffs stay
          // per-slot. (#1015)
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
              const cls = !resolved ? "" : isCorrect ? " y" : " n";
              return (
                <div key={`${sec.sectionid}:${group.groupid}:${slot.index}`} className={`pp-cl${cls}`}>
                  <span className="pp-cl-logo">
                    {team && team.pickid !== 0 ? (
                      <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={40} />
                    ) : (
                      <span className="pp-cl-blank">?</span>
                    )}
                  </span>
                  <span className="pp-cl-nm">{team?.name ?? "No pick"}</span>
                  <span className="pp-cl-b">{tag ?? group.name.split(" | ").slice(-1)[0]}</span>
                  {resolved && (
                    <span className="pp-cl-res" aria-label={isCorrect ? "correct" : "missed"}>
                      {isCorrect ? `+${group.points_per_pick}` : "✕"}
                    </span>
                  )}
                  {slotConsensus.get(consensusKey(sec.sectionid, group.groupid, slot.index)) && (
                    <details className="pp-cl-split">
                      <summary>Field split</summary>
                      <ConsensusBar
                        consensus={slotConsensus.get(consensusKey(sec.sectionid, group.groupid, slot.index))}
                        teamMap={teamMap}
                        highlightPickId={pickId ?? undefined}
                        winnerPickId={winner}
                        max={3}
                      />
                    </details>
                  )}
                </div>
              );
            });
          });
          return (
            <div key={sec.sectionid} className="pp-round">
              {/* Round label only when the playoffs are consolidated — it splits
                  the one bracket reveal into QF / SF / GF bands. */}
              {round && <div className="pp-round-h">{round.label}</div>}
              <div className="pp-grid10">{cards}</div>
            </div>
          );
        })}
      </section>

      {/* Consensus / bold calls */}
      <RoomCalls consensus={consensusCalls} bold={boldCalls} teamMap={teamMap} />

      <section className="cta">
        <Link href={`/leaderboard${majorQ}`} prefetch={false} className="btn-solid">
          View standings
        </Link>
        <Link href={`/players/${encodeURIComponent(subject.id)}${majorQ}`} prefetch={false} className="btn-ghost">
          Full profile
        </Link>
        {playoff ? (
          <StageWrappedReplay stageKey={majorKey} label="Watch the Wrapped recap" />
        ) : stageWrappedHasContent(sectionId) ? (
          <StageWrappedReplay stageKey={stageWrappedKey(EVENT_ID, sectionId)} />
        ) : null}
      </section>
    </div>
  );
}

function RankMove({
  delta,
  rankBefore,
}: {
  delta: { delta: number | null; direction: "up" | "down" | "flat" | "new" } | null;
  rankBefore: number | null;
}) {
  if (!delta || delta.direction === "new" || delta.direction === "flat") return null;
  const moved = Math.abs(delta.delta ?? 0);
  const up = delta.direction === "up";
  return (
    <span
      className={`pp-move ${up ? "up" : "down"}`}
      title={rankBefore != null ? `was ${rankBefore}${ordSuffix(rankBefore)}` : undefined}
    >
      {up ? "▲" : "▼"}{moved}
    </span>
  );
}

type CallStat = { winnerPickId: number; tag: string | null; correctCount: number; total_field: number };

/** "The room saw it" (most-landed correct calls) and "Almost nobody" (bold calls). */
function RoomCalls({
  consensus,
  bold,
  teamMap,
}: {
  consensus: CallStat[];
  bold: CallStat[];
  teamMap: Map<number, TeamDef>;
}) {
  if (consensus.length === 0) return null;
  return (
    <section className="pp-duo">
      <div className="chap">
        <div className="chap-h">
          <span className="n">Consensus</span>
          <h2>The room saw it</h2>
        </div>
        <div>
          {consensus.map((c, i) => (
            <CallRow key={`c${i}`} call={c} teamMap={teamMap} />
          ))}
        </div>
      </div>
      {bold.length > 0 && (
        <div className="chap">
          <div className="chap-h">
            <span className="n">Bold calls</span>
            <h2>Almost nobody</h2>
          </div>
          <div>
            {bold.map((c, i) => (
              <CallRow key={`b${i}`} call={c} teamMap={teamMap} bold />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CallRow({ call, teamMap, bold = false }: { call: CallStat; teamMap: Map<number, TeamDef>; bold?: boolean }) {
  const team = teamMap.get(call.winnerPickId);
  const pct = call.total_field > 0 ? Math.round((call.correctCount / call.total_field) * 100) : 0;
  return (
    <div className="pp-it">
      <span className="pp-it-logo">
        {team && team.pickid !== 0 ? (
          <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={44} />
        ) : (
          <span className="pp-cl-blank">#{call.winnerPickId}</span>
        )}
      </span>
      <div className="pp-it-mid">
        <div className="pp-it-t">
          {team?.name ?? `#${call.winnerPickId}`}
          {call.tag ? <span className="pp-it-tag"> {call.tag}</span> : null}
        </div>
        <div className="pp-it-s">
          {bold ? "only " : ""}
          {call.correctCount} of {call.total_field} called it · hit
        </div>
        <div className={`pp-it-bar${bold ? " bold" : ""}`} aria-hidden="true">
          <i style={{ width: `${Math.max(pct, 1)}%` }} />
        </div>
      </div>
      <span className="pp-it-f">{pct}%</span>
    </div>
  );
}
