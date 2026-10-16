/**
 * Read-only player profile — score, picks per stage, Majors history, coins.
 *
 * Reached by tapping a row on the leaderboard or directory. Applies the
 * reveal-core gate exactly like /leaderboard/compare: a player's individual
 * team choices stay hidden until the stage locks — unless the player sealed
 * that stage PUBLIC (pick-lock-core), which reveals it early with a "Sealed
 * early · public" marker. The viewer's OWN picks are
 * always visible to themselves (no lock gate against yourself), matching the
 * /picks page.
 *
 * `?major=<slug>` (or the legacy `?event=<id>` from /majors) views a previous
 * Major's picks and score read-only — reactions only ever land on the live one.
 */

import { LockIcon } from "@/components/ui/LockIcon";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { buildTeamMap, type Layout } from "@/lib/layout";
import { getEffectiveLayout } from "@/lib/layout-state";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { arePicksRevealed, groupOutcomeKey } from "@/lib/reveal-core";
import { isLockTimePassed, lockTimeForSection } from "@/lib/lock-schedule-core";
import { visibleCoinTier } from "@/lib/coin-core";
import { getSession } from "@/lib/session";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import { bucketSwissSlots, isSwissSection, resolveBucketWinners } from "@/lib/swiss-bucket-core";
import { buildSwissStandings, type SlotPickMap } from "@/lib/swiss-standings-core";
import { LockedPicksBoard } from "@/components/heat/LockedPicksBoard";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { getSwissRecords } from "@/lib/swiss-results";
import { buildBucketConsensus, bucketShareFor } from "@/lib/consensus-core";
import type { Section } from "@/lib/layout";
import { currentEvent } from "@/lib/events-core";
import { resolveEffectiveStatus } from "@/lib/event-lifecycle-core";
import { isRevealForcedById } from "@/lib/event-freeze";
import { isEventArchived } from "@/lib/majors-core";
import { BleachersStrip, type TallyLine } from "@/components/heat/BleachersStrip";
import { tallyReactions, pickTargetKey, type ReactionLike } from "@/lib/bleachers-core";
import { ChallengeCoinShelf } from "@/components/heat/ChallengeCoinShelf";
import { getPlayerChallengeCoins } from "@/lib/challenge-coins";
import { isPublicSeal } from "@/lib/pick-lock-core";
import { getEventSeals } from "@/lib/pick-lock";
import { EyeIcon } from "@/components/sg/picks/SealPicks";
import {
  dayMonth,
  majorPhoto,
  majorShortName,
  monthYear,
  ordSuffix,
  playerMajorsHistory,
  requestedEvent,
} from "@/components/sg/people/people-data";

/** Short pick-type tag for a slot (3:0 / 3:1·3:2 / 0:3 for Swiss; — otherwise). */
function bucketLabelFor(sectionId: number, group: Section["groups"][number], slotIndex: number): string | null {
  if (!isSwissSection(sectionId)) return null;
  const buckets = bucketSwissSlots(group.picks.length);
  const hit = buckets.find((b) => b.slotIndexes.includes(slotIndex));
  if (!hit || hit.label === "PICKS") return null;
  return hit.label.replace(" ADVANCED", "").replace(" ELIMINATED", "");
}

/** Per-slot verdict for the stage strip: hit, miss, or still open. */
type Dot = "y" | "x" | "o";

/** A correct call made by this share of the field or fewer counts as "bold". */
const BOLD_SHARE = 0.1;
const BOLD_MIN_FIELD = 5;

export default async function PlayerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Published lock schedule (#898): reveal a started stage's picks even before
  // Valve flips picks_allowed or a result lands. Dynamic RSC — time read intended.
  const nowMs = Date.now();
  const live = currentEvent(nowMs); // per-request active event (#1046)
  const sp = await searchParams;
  const event = requestedEvent(sp) ?? live;
  const EVENT_ID = event.eventId;
  const isLiveView = EVENT_ID === live.eventId;
  const { id } = await params;
  // The event's own layout; null until Valve opens its Pick'Em, in which case
  // there are no stages to show (never the previous Major's).
  const effectiveLayout = await getEffectiveLayout(EVENT_ID);
  const preOpen = effectiveLayout === null;
  const layout: Layout = effectiveLayout ?? { event: EVENT_ID, name: event.name, sections: [], teams: [] };
  const teamMap = buildTeamMap(layout);
  const session = await getSession();
  await refreshOutcomesOnRead(EVENT_ID); // live driver (#866) — shared 30s claim; no-op once frozen

  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) notFound();

  const isSelf = session?.playerId === player.id;
  const profileHref = `/players/${encodeURIComponent(player.id)}`;
  const majorQ = isLiveView ? "" : `?major=${encodeURIComponent(event.slug)}`;

  // #954: a finished (effectively archived) Major is public history — reveal
  // every stage regardless of its per-stage lock. No-op while live (false).
  const eventArchived = await isRevealForcedById(EVENT_ID, nowMs);

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

  // The Bleachers (#1211): every reaction landed on THIS player's picks, one
  // query, indexed by pick. Senders ride along for the viewer's own "mine" flag
  // and the resolve-time unmask, but tallyReactions only ever emits public counts
  // for everyone else. A signed-in viewer who isn't the owner can drop a stamp —
  // on the live Major only (the reactions API writes to the live event).
  const viewerId = session?.playerId ?? null;
  const canReact = !!session && !isSelf && isLiveView;
  const reactionRows = await prisma.reaction.findMany({
    where: { eventId: EVENT_ID, targetPlayerId: player.id },
    select: { stampId: true, senderId: true, sectionId: true, groupId: true, slotIndex: true },
  });
  const reactionsByPick = new Map<string, ReactionLike[]>();
  for (const r of reactionRows) {
    const k = pickTargetKey(r.sectionId, r.groupId, r.slotIndex);
    const list = reactionsByPick.get(k);
    if (list) list.push(r);
    else reactionsByPick.set(k, [r]);
  }
  const tallyFor = (sectionId: number, groupId: number, slotIndex: number): TallyLine[] =>
    tallyReactions(reactionsByPick.get(pickTargetKey(sectionId, groupId, slotIndex)) ?? [], viewerId).map(
      (t) => ({ id: t.stamp.id, glyph: t.stamp.glyph, label: t.stamp.label, kind: t.stamp.kind, count: t.count, mine: t.mine }),
    );

  // This player's self-seals (pick-lock-core) — a public one reveals early.
  const seals = await getEventSeals(EVENT_ID, [player.id]);

  const breakdown = scorePlayer(layout, pickMap, outcomeMap);
  const score = breakdown.total;
  const pointsBySection = new Map(breakdown.bySection.map((b) => [b.sectionId, b.points] as const));
  const coinTier = visibleCoinTier(player);

  // Challenge coins (#1278) — the collectible track: one struck Major coin
  // per event this player took part in, minted when the Major concludes. Empty
  // while the live event is still in flight (adds no DB work until it archives).
  const challengeCoins = await getPlayerChallengeCoins(player.id, nowMs);

  // Majors history — every Major this player has played, newest first.
  const history = await playerMajorsHistory(player.id, nowMs);
  const finished = history.filter((h) => isEventArchived(h.status));
  const coinByEvent = new Map(challengeCoins.map((c) => [c.eventId, c] as const));

  // Rank — score this player against the whole field (mockup-06 stat hero).
  const allPlayers = await prisma.player.findMany({ select: { id: true, displayName: true } });
  const allPicks = await prisma.pick.findMany({
    where: { eventId: EVENT_ID },
    select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
  });
  // Field-wide pick distribution (#889), measured per Swiss bucket so all
  // 0:3 calls for a team count together regardless of slot (#900 follow-up).
  // Only surfaced on revealed (post-lock) groups below, so it never leaks live
  // picks or invites herding.
  const consensus = buildBucketConsensus(allPicks);

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

  // Live partial W-L per Swiss section (#951) so a 3:0/0:3 pick strikes red as
  // soon as the team's record rules its bucket out — for THIS player too, not just
  // your own /picks view. Reads the cached HLTV standings (no crawl); empty when
  // cold. Keyed by section so each stage is judged against its own records.
  const matchTeams = layout.teams.map((t) => ({ pickid: t.pickid, name: t.name }));
  const recordsBySection = new Map<number, Map<number, { wins: number; losses: number }>>();
  await Promise.all(
    layout.sections
      .filter((s) => isSwissSection(s.sectionid))
      .map(async (s) => {
        recordsBySection.set(s.sectionid, await getSwissRecords(EVENT_ID, s.sectionid, matchTeams));
      }),
  );

  // Accuracy — correct picks over resolved picks (only counts decided slots).
  // Swiss buckets are interchangeable: a pick is correct if its team landed
  // ANYWHERE in the bucket, not at its exact slot (#946/918). Per-slot
  // comparison here under-counts correct Swiss picks and disagrees with the
  // set-based scorer that drives Points/Rank. Playoffs stay per-slot. (#1015)
  // The same pass records each slot's verdict for the stage strip and counts
  // bold calls (right, and made by ≤10% of the field).
  let resolved = 0;
  let correct = 0;
  let boldHits = 0;
  const dotsBySection = new Map<number, Dot[]>();
  const resolvedBySection = new Map<number, number>();
  for (const section of layout.sections) {
    const swiss = isSwissSection(section.sectionid);
    const dots: Dot[] = [];
    let secResolved = 0;
    for (const group of section.groups) {
      const gOut = outcomeMap[section.sectionid]?.[group.groupid] ?? {};
      const gPick = pickMap[section.sectionid]?.[group.groupid] ?? {};
      const groupBuckets = swiss ? bucketSwissSlots(group.picks.length) : null;
      for (const slot of group.picks) {
        const winner = gOut[slot.index];
        if (winner === undefined) {
          dots.push("o");
          continue;
        }
        resolved += 1;
        secResolved += 1;
        const pick = gPick[slot.index];
        const bucket = groupBuckets?.find((b) => b.slotIndexes.includes(slot.index)) ?? null;
        const hit = bucket
          ? pick != null && resolveBucketWinners(bucket.slotIndexes, gOut).winners.has(pick)
          : pick === winner;
        if (hit) {
          correct += 1;
          const share = pick != null ? bucketShareFor(consensus, section.sectionid, group.groupid, slot.index, pick) : null;
          if (share && share.total >= BOLD_MIN_FIELD && share.count / share.total <= BOLD_SHARE) boldHits += 1;
        }
        dots.push(hit ? "y" : "x");
      }
    }
    dotsBySection.set(section.sectionid, dots);
    resolvedBySection.set(section.sectionid, secResolved);
  }
  const accuracy = resolved > 0 ? Math.round((correct / resolved) * 100) : null;

  const maxPoints = layout.sections.reduce(
    (acc, s) => acc + s.groups.reduce((g, grp) => g + grp.picks.length * grp.points_per_pick, 0),
    0,
  );

  const joinLabel = monthYear(player.createdAt.toISOString());
  const provenance = player.isLocal ? "Local" : player.synced ? "Steam-synced" : "Steam";
  const eventName = majorShortName(event);
  const liveName = majorShortName(live);
  const eventStatus = resolveEffectiveStatus(event, nowMs);

  // Chapter headline — a statement, not a label.
  const who = isSelf ? "You" : player.displayName;
  const statHead =
    resolved === 0
      ? "All to play for"
      : rank === 1 && score > 0
        ? isEventArchived(eventStatus) ? "Top of the board, final" : "Top of the board"
        : rank > 0
          ? `${rank}${ordSuffix(rank)} on the board`
          : "Unranked";
  const statCopy =
    preOpen ? (
      <>Pick&apos;Em isn&apos;t open yet at {eventName}. Stages appear when Valve opens it.</>
    ) : resolved === 0 ? (
      <>Nothing is scored yet at {eventName}. <b>{maxPoints} points</b> are on the table.</>
    ) : (
      <>
        {who} landed <b>{correct} of {resolved}</b> calls
        {rank > 1 ? <>, {leaderScore - score} point{leaderScore - score !== 1 ? "s" : ""} off the lead.</> : "."}
      </>
    );

  // Swiss vs playoff rows share one strip; this decides a row's small status line.
  const stageStatus = (section: Section): string => {
    const total = section.groups.reduce((n, g) => n + g.picks.length, 0);
    const done = resolvedBySection.get(section.sectionid) ?? 0;
    if (total > 0 && done >= total) return "scored";
    if (done > 0) return "in progress";
    if (isLockTimePassed(section.sectionid, nowMs, event.lockSchedule) || eventArchived) return "locked";
    const iso = lockTimeForSection(section.sectionid, event.lockSchedule);
    return iso ? `locks ${dayMonth(iso)}` : "open";
  };

  const gear = (
    <Link href="/settings" prefetch={false} className="profile-gear" aria-label="Settings">
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </Link>
  );

  return (
    <div className="pp-page">
      {/* Hero (mockup 06). Self gets a gear cog → /settings (#1275): the
          profile is the clean stat card, the gear is the one door to settings. */}
      <section className={`bleed pp-hero${isSelf ? " self" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/wrapped/major-nations.jpg" alt="" />
        <span className="credit">Photo · HLTV</span>
        {isSelf && gear}
        <div className="in">
          <div className="pp-hero-av rise">
            {player.avatarUrl ? (
              <Image src={player.avatarUrl} alt="" width={132} height={132} unoptimized />
            ) : (
              player.displayName.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="pp-hero-id rise d1">
            <span className="eyebrow">
              {isSelf ? "Your profile" : "Player"} · <b>{provenance}</b>
              {joinLabel ? ` · since ${joinLabel}` : ""}
            </span>
            <h1 className="display">{player.displayName}</h1>
          </div>
          <nav className="pp-hero-links rise d2" aria-label="Profile links">
            <Link className="eyebrow" href="/leaderboard" prefetch={false}>← Leaderboard</Link>
            {isSelf && <Link className="eyebrow" href="/majors" prefetch={false}>Majors</Link>}
            {isSelf && <Link className="eyebrow" href="/notifications" prefetch={false}>Inbox</Link>}
            {session && !isSelf && (
              <Link className="eyebrow" href={`/leaderboard/compare?b=${encodeURIComponent(player.id)}`} prefetch={false}>
                Compare
              </Link>
            )}
            <Link className="eyebrow" href="/players" prefetch={false}>Directory</Link>
          </nav>
        </div>
      </section>

      {!isLiveView && (
        <div className="pp-viewing" role="status">
          <span className="eyebrow">
            Viewing <b>{eventName}</b> · {isEventArchived(eventStatus) ? "final" : eventStatus}
          </span>
          <Link className="eyebrow" href={profileHref} prefetch={false}>Back to {liveName} →</Link>
        </div>
      )}

      {/* Stat strip (mockup 06) */}
      <section className="chap">
        <div className="chap-h row2">
          <div>
            <span className="n">{eventName}</span>
            <h2>{statHead}</h2>
            <p>{statCopy}</p>
          </div>
          {session && !isSelf && (
            <Link href={`/leaderboard/compare?b=${encodeURIComponent(player.id)}`} prefetch={false} className="btn-solid">
              Compare with mine
            </Link>
          )}
        </div>
        <div className="cells" style={{ ["--n" as string]: 4 } as React.CSSProperties}>
          <div>
            <span className="k">Rank</span>
            <span className="v">{rank > 0 ? String(rank).padStart(2, "0") : "—"}</span>
            <span className="s">
              {rank > 0
                ? rank === 1
                  ? fieldSize > 1 ? `of ${fieldSize} · leading` : "Only player"
                  : `of ${fieldSize} · ${leaderScore - score} from leader`
                : "Unranked"}
            </span>
          </div>
          <div>
            <span className="k">Points</span>
            <span className="v foil">{score}</span>
            <span className="s">of {maxPoints} possible</span>
          </div>
          <div>
            <span className="k">Hit rate</span>
            <span className="v">{accuracy === null ? "—" : `${accuracy}%`}</span>
            <span className="s">{accuracy === null ? "No results yet" : `${correct} of ${resolved} correct`}</span>
          </div>
          <div>
            <span className="k">Bold calls hit</span>
            <span className="v">{resolved === 0 ? "—" : boldHits}</span>
            <span className="s">called by 10% or fewer</span>
          </div>
        </div>

        {/* Viewer Pass coin — only when a real Valve coin tier is visible */}
        {coinTier && (
          <div className="pp-vcoin">
            <span className={`coin-sticker ${coinTier} coin-big`} />
            <div>
              <div className={`coin-tier-name ${coinTier}`}>{coinTier} Viewer Pass</div>
              <div className="coin-desc">{score} pts · mirrored from your Valve coin</div>
            </div>
          </div>
        )}
      </section>

      {/* Call by call — one hairline row per stage (dots = each call), and each
          row expands (#1283) into the full board. Swiss stages render in the
          SAME locked-picks UI as /picks — the 3:0 / advance / 0:3 buckets, each
          call green when confirmed right, red when wrong OR no longer winnable
          (#902). Playoffs keep the per-match blocks with the Bleachers strip. */}
      <section className="chap">
        <div className="chap-h row2">
          <div>
            <h2>Call by call</h2>
            <p>Every stage at a glance. <b>Tap a stage</b> to open the full board.</p>
          </div>
          {isSelf && isLiveView && !preOpen && (
            <Link className="btn-ghost" href="/picks" prefetch={false}>Your picks</Link>
          )}
        </div>
        {preOpen && (
          <p className="muted">
            <b>Pick&apos;Em isn&apos;t open yet.</b> Every stage shows up here once Valve opens Pick&apos;Em for this Major.
          </p>
        )}
        <div className="pp-stages">
          {layout.sections.map((section) => {
            const stageLabel = section.name.split(" | ")[0];
            const ppp = section.groups[0]?.points_per_pick ?? 1;
            const lockRevealedAll = section.groups.every((group) =>
              arePicksRevealed(
                group,
                groupHasOutcome.has(groupOutcomeKey(section.sectionid, group.groupid)),
                isLockTimePassed(section.sectionid, nowMs, event.lockSchedule),
                eventArchived,
              ),
            );
            // Self-seal (pick-lock-core): a PUBLIC seal shows this player's calls
            // to everyone before the stage locks; a hidden one changes nothing.
            const seal = seals.sealFor(player.id, section.sectionid);
            const publicSeal = isPublicSeal(seal);
            const showVerdicts = isSelf || lockRevealedAll || publicSeal;
            const sealNote =
              seal && !lockRevealedAll && (isSelf || publicSeal) ? (
                <div className="sgs-marks" style={{ marginBottom: 12 }}>
                  <span className={`sgs-mark${publicSeal ? "" : " hid"}`} style={publicSeal ? undefined : { color: "var(--ink-mid)" }}>
                    <EyeIcon off={!publicSeal} size={12} />
                    {publicSeal ? "Sealed early · public" : "Sealed · hidden until the stage locks"}
                  </span>
                  {seal.steamDivergedAt && <span className="sgs-mark warn">Changed in-game after sealing</span>}
                </div>
              ) : null;
            const dots = dotsBySection.get(section.sectionid) ?? [];
            const secResolved = resolvedBySection.get(section.sectionid) ?? 0;
            const pts = pointsBySection.get(section.sectionid) ?? 0;
            const summary = (hint: string) => (
              <summary className="pp-sb">
                <span className="pp-sb-k">
                  {stageLabel}
                  <small>
                    {ppp} pt{ppp !== 1 ? "s" : ""} · {stageStatus(section)}
                  </small>
                </span>
                <span className="pp-sb-dots" style={{ ["--n" as string]: Math.max(dots.length, 1) } as React.CSSProperties} aria-hidden="true">
                  {dots.map((d, i) => (
                    <i key={i} className={showVerdicts ? d : "o"} />
                  ))}
                </span>
                <span className={`pp-sb-p${secResolved === 0 || !showVerdicts ? " m" : ""}`}>
                  {secResolved > 0 && showVerdicts ? pts : "—"}
                </span>
                <span className="pp-sb-hint">{hint}</span>
              </summary>
            );
            const revealLink =
              isSelf && secResolved > 0 ? (
                <Link className="eyebrow pp-sb-reveal" href={`/reveal/${section.sectionid}${majorQ}`} prefetch={false}>
                  {stageLabel} reveal →
                </Link>
              ) : null;

            if (isSwissSection(section.sectionid)) {
              const group = section.groups[0];
              const revealed =
                isSelf ||
                arePicksRevealed(
                  group,
                  groupHasOutcome.has(groupOutcomeKey(section.sectionid, group.groupid)),
                  isLockTimePassed(section.sectionid, nowMs, event.lockSchedule),
                  eventArchived,
                ) ||
                publicSeal;
              if (!revealed) {
                return (
                  <details key={section.sectionid} className="stage-fold">
                    {summary("Hidden until lock")}
                    <div className="stage-fold-body">
                      <div className="pp-locked">
                        <LockIcon size={11} /> Hidden until this stage locks
                      </div>
                    </div>
                  </details>
                );
              }
              const swiss = buildSwissStandings(
                section,
                (outcomeMap[section.sectionid] ?? {}) as SlotPickMap,
                bucketSwissSlots,
                (pickMap[section.sectionid] ?? {}) as SlotPickMap,
              );
              const teamStatus = new Map(swiss.teams.map((t) => [t.pickid, t.status] as const));
              const groupResolved = Object.keys(outcomeMap[section.sectionid]?.[group.groupid] ?? {}).length >= group.picks.length;
              return (
                <details key={section.sectionid} className="stage-fold">
                  {summary(publicSeal && !lockRevealedAll ? "Sealed early · public" : "Turns green / red as teams clinch")}
                  <div className="stage-fold-body">
                    {revealLink}
                    {sealNote}
                    <LockedPicksBoard
                      bare
                      section={section}
                      teamMap={teamMap}
                      myPicks={pickMap[section.sectionid] ?? {}}
                      teamStatus={teamStatus}
                      recordByTeam={recordsBySection.get(section.sectionid)}
                      resolvedAtIso={null}
                      title={stageLabel.toUpperCase()}
                      reactions={!isSelf ? {
                        targetPlayerId: player.id,
                        canReact: canReact && !groupResolved,
                        tallyFor: (groupId, slotIndex) => tallyFor(section.sectionid, groupId, slotIndex),
                      } : undefined}
                    />
                  </div>
                </details>
              );
            }
            // Non-Swiss (playoffs): keep the per-match blocks, inside the expandable row.
            return (
              <details key={section.sectionid} className="stage-fold">
                {summary(publicSeal && !lockRevealedAll ? "Sealed early · public" : "Playoffs")}
                <div className="stage-fold-body">
                  {revealLink}
                  {sealNote}
                  {section.groups.map((group) => {
                    // Self always sees own picks; others wait for stage lock.
                    const lockRevealed = arePicksRevealed(
                      group,
                      groupHasOutcome.has(groupOutcomeKey(section.sectionid, group.groupid)),
                      isLockTimePassed(section.sectionid, nowMs, event.lockSchedule),
                      eventArchived,
                    );
                    const revealed = isSelf || lockRevealed || publicSeal;
                    const groupPicks = pickMap[section.sectionid]?.[group.groupid] ?? {};
                    const groupOutcomes = outcomeMap[section.sectionid]?.[group.groupid] ?? {};

                    return (
                      <div key={group.groupid} className="pp-match">
                        <div className="pp-match-head">
                          <span>{group.name.split(" | ").slice(-1)[0]}</span>
                          <span>
                            {group.points_per_pick} pt{group.points_per_pick !== 1 ? "s" : ""}/pick
                          </span>
                        </div>

                        {!revealed ? (
                          <div className="pp-locked">
                            <LockIcon size={11} /> Hidden until this stage locks
                          </div>
                        ) : (
                          // Revealed playoff picks render as full-width blocks so the
                          // Bleachers strip (#1211) sits beneath each pick.
                          <div className="pickbleach-list">
                            {group.picks.map((slot) => {
                              const pick = groupPicks[slot.index];
                              const team = pick ? teamMap.get(pick) : null;
                              const winner = groupOutcomes[slot.index];
                              const hit = winner !== undefined && pick === winner;
                              const wrong = winner !== undefined && pick !== undefined && pick !== winner;
                              const typeLabel = bucketLabelFor(section.sectionid, group, slot.index);
                              // Consensus % stays gated on the LOCK (not isSelf): showing the
                              // field split while a stage is still open invites herd-following
                              // even on your own profile (#889). Your pick still shows; only
                              // the % waits for lock — same discipline as the reveal gate.
                              const share = pick && lockRevealed
                                ? bucketShareFor(consensus, section.sectionid, group.groupid, slot.index, pick)
                                : null;
                              const shareLabel = (() => {
                                if (!share) return null;
                                const total = share.total;
                                if (total < 2) return null;
                                const lone = share.count === 1;
                                return {
                                  lone,
                                  text: lone
                                    ? "Lone call"
                                    : share.count === total
                                      ? "Whole board"
                                      : `${share.count} of ${total} picked`,
                                  title: `${share.count} of ${total} players made this same call`,
                                };
                              })();
                              return (
                                <div key={slot.index} className="pickbleach-item">
                                  <div className={`pickbleach-head${hit ? " correct" : wrong ? " wrong" : ""}`}>
                                    {team ? (
                                      <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={36} />
                                    ) : (
                                      <div className="pp-nologo">—</div>
                                    )}
                                    <span className="pickbleach-team">{team ? team.name : "—"}</span>
                                    {typeLabel && <span className="pickcard-type">{typeLabel}</span>}
                                    {shareLabel && (
                                      <span className={`pickcard-share${shareLabel.lone ? " lone" : ""}`} title={shareLabel.title}>
                                        {shareLabel.text}
                                      </span>
                                    )}
                                    {winner !== undefined && (
                                      <span className={`pickcard-icon ${hit ? "correct" : "wrong"}`}>
                                        {hit ? "✓" : "✗"}
                                      </span>
                                    )}
                                  </div>
                                  {/* Playoffs stay reactable match-by-match: the bracket is
                                      the live event, so a resolved QF/SF must NOT silently
                                      lock reactions (#1262). Swiss read-only-on-resolve
                                      is handled in the Swiss branch above. */}
                                  {(lockRevealed || publicSeal) && pick != null && (
                                    <BleachersStrip
                                      targetPlayerId={player.id}
                                      sectionId={section.sectionid}
                                      groupId={group.groupid}
                                      slotIndex={slot.index}
                                      initialTally={tallyFor(section.sectionid, group.groupid, slot.index)}
                                      canReact={canReact}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </section>

      {/* Majors played — every concluded Major, each opening its read-only view. */}
      {(finished.length > 0 || isSelf) && (
        <section className="chap">
          <div className="chap-h row2">
            <div>
              <h2>Majors played</h2>
              {finished.length === 0 && <p>Finished Majors land here, with your score and finish in each.</p>}
            </div>
            {isSelf && <Link className="eyebrow" href="/majors" prefetch={false}>All Majors →</Link>}
          </div>
          {finished.length > 0 && (
            <div className="pp-hist">
              {finished.map((h) => {
                const photo = majorPhoto(h.slug);
                const coin = coinByEvent.get(h.eventId);
                const viewing = h.eventId === EVENT_ID;
                return (
                  <Link
                    key={h.eventId}
                    href={`${profileHref}?major=${encodeURIComponent(h.slug)}`}
                    prefetch={false}
                    className={`pp-hist-card${viewing ? " on" : ""}`}
                    aria-current={viewing ? "page" : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.src} alt="" loading="lazy" />
                    <span className="eyebrow">{monthYear(h.start)}{viewing ? " · viewing" : ""}</span>
                    <span className="pp-hist-nm">{majorShortName(h)}</span>
                    <span className="pp-hist-f">
                      <span>
                        {!h.scored ? "Score unavailable" : h.finish != null ? <><b>{h.finish}{ordSuffix(h.finish)}</b> of {h.fieldSize}</> : "Not scored"}
                      </span>
                      {h.scored && <span><b>{h.score}</b> pts</span>}
                      {coin && <span className="pp-cap">{coin.tier} coin</span>}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Challenge coins (#1278) — the coin case */}
      <ChallengeCoinShelf
        coins={challengeCoins}
        isSelf={isSelf}
        pending={
          !isEventArchived(resolveEffectiveStatus(live, nowMs))
            ? { name: liveName, note: "Mints at the Grand Final" }
            : null
        }
      />
    </div>
  );
}
