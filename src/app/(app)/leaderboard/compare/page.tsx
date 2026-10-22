/**
 * Pick comparison — head-to-head (#900), Singapore skin (prototype 14).
 *
 * The hook: when a stage is revealed AND results have landed, the picks YOU
 * called right that your opponent whiffed ("THE STEAL") get top billing.
 * Above it, an agreement strip (how many calls you share); below it, every
 * stage split into its buckets, your picks lined up against theirs with the
 * shared calls first, hit/miss marked once a result exists.
 *
 * Reveal rule (#862 / #898 + pick-lock-core): a group's team choices stay
 * hidden until its stage locks (either Valve flips picks_allowed, the published
 * lock time passes, or a result lands) — UNLESS that player sealed the stage
 * PUBLIC, in which case their side shows right away with a "Sealed early ·
 * public" marker. The viewer always sees their own side. Hidden sides are
 * masked server-side (never shipped). Scores are always public.
 * Section-qualified pick maps prevent a revealed stage from leaking a still-open
 * stage's secret pick across a reused groupid.
 *
 * `?major=<slug>` compares a past registered event (read-only: no outcome
 * refresh, no reactions, entrants only). Unknown / current slug → live event.
 */

import { LockIcon } from "@/components/ui/LockIcon";
import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCommittedLayout, buildTeamMap, type TeamDef } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { arePicksRevealed, groupOutcomeKey } from "@/lib/reveal-core";
import { getSession } from "@/lib/session";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { isLockTimePassed } from "@/lib/lock-schedule-core";
import { resolveLogoTiers } from "@/lib/logos";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { BleachersStrip, type TallyLine } from "@/components/heat/BleachersStrip";
import { tallyReactions, pickTargetKey, type ReactionLike } from "@/lib/bleachers-core";
import {
  bucketSwissSlots,
  isSwissSection,
  resolveBucketWinners,
  bucketPickState,
} from "@/lib/swiss-bucket-core";
import { isBucketImpossibleByRecord } from "@/lib/swiss-standings-core";
import { getSwissRecords } from "@/lib/swiss-results";
import { currentEvent } from "@/lib/events-core";
import { isRevealForcedById } from "@/lib/event-freeze";
import { eventShortName, layoutForEvent, resolveArchiveEvent } from "@/lib/leaderboard";
import { RankAvatar } from "@/components/sg/ranks/RankAvatar";
import { visibilityReason, isPublicSeal } from "@/lib/pick-lock-core";
import { getEventSeals } from "@/lib/pick-lock";
import { EyeIcon } from "@/components/sg/picks/SealPicks";
import { nameFit, nameLineChars } from "@/lib/name-fit";
import { PHOTOS } from "@/lib/photos";

export const dynamic = "force-dynamic";

type PlayerLite = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isLocal: boolean;
  synced: boolean;
};

function toPlayerPickMap(picks: { sectionId: number; groupId: number; slotIndex: number; pickId: number }[]): PlayerPickMap[string] {
  const m: PlayerPickMap[string] = {};
  for (const p of picks) {
    m[p.sectionId] ??= {};
    m[p.sectionId][p.groupId] ??= {};
    m[p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }
  return m;
}

function provenance(p: PlayerLite): string {
  return p.isLocal ? "Local" : p.synced ? "Synced" : "Steam";
}

/** "3:0 ADVANCED" → "3–0", "3:1 / 3:2 ADVANCED" → "Advance", "0:3 ELIMINATED" → "0–3". */
function bucketTitle(label: string): string {
  if (/^3:0/.test(label)) return "3–0";
  if (/^0:3/.test(label)) return "0–3";
  if (/ADVANCED/i.test(label)) return "Advance";
  return label;
}

type TileState = "hit" | "miss" | "pending" | "empty";

/** One side of a split row — logo + name + ✓/✕ once judged. `hidden` = this
 *  player's calls are still under wraps (the other side sealed public early). */
function PickSide({ team, state, steal, hidden = false }: { team: TeamDef | undefined; state: TileState; steal: boolean; hidden?: boolean }) {
  if (hidden) {
    return (
      <span className="cmp-s hid">
        <span className="tile cmp-blank" aria-hidden>
          <LockIcon size={12} />
        </span>
        <span className="cmp-nm">Under wraps</span>
      </span>
    );
  }
  const name = team?.name ?? "—";
  return (
    <span className={`cmp-s ${state}${steal ? " steal" : ""}`}>
      {team ? (
        <TeamLogo tiers={resolveLogoTiers(team)} teamName={name} size={30} />
      ) : (
        <span className="tile cmp-blank" aria-hidden />
      )}
      <span className="cmp-nm">{name}</span>
      {state === "hit" && (
        <span className="cmp-r y" aria-label="correct">
          ✓
        </span>
      )}
      {state === "miss" && (
        <span className="cmp-r n" aria-label="missed">
          ✕
        </span>
      )}
    </span>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string; major?: string }>;
}) {
  const params = await searchParams;
  const archive = resolveArchiveEvent(params.major);
  // Per-request active event (#1046), or the requested past Major.
  const event = archive ?? currentEvent();
  const EVENT_ID = event.eventId;
  const eventName = eventShortName(event);
  const majorQ = archive ? `major=${encodeURIComponent(archive.slug)}&` : "";
  const boardHref = archive ? `/leaderboard?major=${encodeURIComponent(archive.slug)}` : "/leaderboard";
  const compareHref = (aId: string, bId: string) => `/leaderboard/compare?${majorQ}a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}`;

  const layout = archive ? layoutForEvent(EVENT_ID) : getCommittedLayout();
  if (!layout) {
    return (
      <div className="rk-page">
        <section className="chap">
          <div className="chap-h">
            <span className="eyebrow">
              Head to head · <b>{eventName}</b>
            </span>
            <h2>Not on this build</h2>
            <p>
              Picks for <b>{eventName}</b>{" "}are stored but can&apos;t be laid out here yet.
            </p>
          </div>
          <div className="cta">
            <Link href="/leaderboard" prefetch={false} className="btn-ghost">
              ← Live board
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const teamMap = buildTeamMap(layout);
  const session = await getSession();
  if (!archive) await refreshOutcomesOnRead(EVENT_ID); // live driver (#866) — shared 30s claim

  // Live partial W-L per Swiss section (#951): a 3:0/0:3 pick reads red in the
  // grid the moment the team's record rules its bucket out, before the answer key
  // resolves it. Reads the cached HLTV standings (no crawl); empty when cold.
  const matchTeams = layout.teams.map((t) => ({ pickid: t.pickid, name: t.name }));
  const recordsBySection = new Map<number, Map<number, { wins: number; losses: number }>>();
  await Promise.all(
    layout.sections
      .filter((s) => isSwissSection(s.sectionid))
      .map(async (s) => {
        recordsBySection.set(s.sectionid, await getSwissRecords(EVENT_ID, s.sectionid, matchTeams));
      }),
  );

  // Per-request server clock for the published lock schedule (#898): a stage
  // that has begun reveals its picks for comparison even before Valve flips
  // picks_allowed or a result lands. Dynamic RSC, so reading the time is intended.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  // #954: once the Major is effectively archived (its real Grand Final
  // resolved), every stage is public history regardless of its per-stage lock —
  // the `eventArchived` reveal signal. No-op while the event is live (false), so
  // the per-stage lock gate alone decides reveal, exactly as before.
  const eventArchived = await isRevealForcedById(EVENT_ID, nowMs);

  // Load every pick + outcome for the event once.
  const allPicks = await prisma.pick.findMany({ where: { eventId: EVENT_ID } });
  const outcomes = await prisma.stageOutcome.findMany({ where: { eventId: EVENT_ID } });

  const picksByPlayer = new Map<string, typeof allPicks>();
  for (const p of allPicks) {
    const arr = picksByPlayer.get(p.playerId) ?? [];
    arr.push(p);
    picksByPlayer.set(p.playerId, arr);
  }

  const allPlayers: PlayerLite[] = await prisma.player.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, avatarUrl: true, isLocal: true, synced: true },
  });
  // A past Major compares only the players who actually played it.
  const players = archive ? allPlayers.filter((p) => picksByPlayer.has(p.id)) : allPlayers;

  // Need at least two players to compare.
  if (players.length < 2) {
    return (
      <div className="rk-page">
        <section className="chap">
          <div className="chap-h">
            <span className="eyebrow">Head to head</span>
            <h2>Two players minimum</h2>
            <p>You need at least two players on the board before you can compare picks.</p>
          </div>
          <div className="cta">
            <Link href={boardHref} prefetch={false} className="btn-ghost">
              ← Leaderboard
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const outcomeMap: OutcomeMap = {};
  const groupHasOutcome = new Set<string>(); // `${sectionId}:${groupId}` with ≥1 resolved slot
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    groupHasOutcome.add(groupOutcomeKey(o.sectionId, o.groupId));
  }

  // Rank players to pick sensible defaults (self vs top opponent).
  const ranked = players
    .map((p) => ({
      player: p,
      score: scorePlayer(layout, toPlayerPickMap(picksByPlayer.get(p.id) ?? []), outcomeMap).total,
    }))
    .sort((x, y) => y.score - x.score || x.player.displayName.localeCompare(y.player.displayName));
  const rankOf = (id: string) => ranked.findIndex((r) => r.player.id === id) + 1;

  const defaultA = (session && ranked.find((r) => r.player.id === session.playerId)?.player.id) || ranked[0].player.id;
  const aId = params.a && players.some((p) => p.id === params.a) ? params.a : defaultA;
  const defaultB = ranked.find((r) => r.player.id !== aId)!.player.id;
  const bId = params.b && params.b !== aId && players.some((p) => p.id === params.b) ? params.b : defaultB;

  const a = players.find((p) => p.id === aId)!;
  const b = players.find((p) => p.id === bId)!;
  const aIsYou = session?.playerId === aId;
  const bIsYou = session?.playerId === bId;
  const aName = aIsYou ? "You" : a.displayName;

  const viewerId = session?.playerId ?? null;
  // Past Majors are read-only history — no new reactions.
  const canReactA = !archive && !!session && session.playerId !== aId;
  const canReactB = !archive && !!session && session.playerId !== bId;

  const reactionRows = await prisma.reaction.findMany({
    where: { eventId: EVENT_ID, targetPlayerId: { in: [aId, bId] } },
    select: { stampId: true, senderId: true, sectionId: true, groupId: true, slotIndex: true, targetPlayerId: true },
  });
  const reactionsByPlayerPick = new Map<string, ReactionLike[]>();
  for (const r of reactionRows) {
    const k = `${r.targetPlayerId}:${pickTargetKey(r.sectionId, r.groupId, r.slotIndex)}`;
    const list = reactionsByPlayerPick.get(k);
    if (list) list.push(r);
    else reactionsByPlayerPick.set(k, [r]);
  }
  const tallyFor = (targetPlayerId: string, sectionId: number, groupId: number, slotIndex: number): TallyLine[] =>
    tallyReactions(reactionsByPlayerPick.get(`${targetPlayerId}:${pickTargetKey(sectionId, groupId, slotIndex)}`) ?? [], viewerId).map(
      (t) => ({ id: t.stamp.id, glyph: t.stamp.glyph, label: t.stamp.label, kind: t.stamp.kind, count: t.count, mine: t.mine }),
    );

  // Section-qualified pick maps (sectionId → groupId → slotIndex → pickId).
  // Must NOT be keyed by groupId alone (see #862): a groupId-only map collides
  // if Valve reuses a groupid across sections, leaking a still-open section's
  // secret pick. Reuse toPlayerPickMap, which scoring also uses.
  const aPicksMap = toPlayerPickMap(picksByPlayer.get(aId) ?? []);
  const bPicksMap = toPlayerPickMap(picksByPlayer.get(bId) ?? []);

  const aScore = scorePlayer(layout, aPicksMap, outcomeMap).total;
  const bScore = scorePlayer(layout, bPicksMap, outcomeMap).total;
  const lead = aScore - bScore;

  const team = (pickId: number | undefined): TeamDef | undefined =>
    pickId && pickId !== 0 ? teamMap.get(pickId) : undefined;

  // Walk every revealed slot once: THE STEAL (picks one player nailed that the
  // other whiffed), the shared-hit count and the agreement strip (calls both
  // made identically). Only revealed groups are inspected, so this never leaks
  // a hidden pick.
  const aSteals: { team: TeamDef; label: string }[] = [];
  const bSteals: { team: TeamDef; label: string }[] = [];
  let bothRight = 0;
  let agreed = 0;
  let compared = 0;
  // sectionId:groupid → revealed?  (computed once, reused by the grid below)
  const revealedByGroup = new Map<string, boolean>();

  // Self-seals (pick-lock-core). Archived Majors are fully revealed anyway.
  const seals = await getEventSeals(EVENT_ID);
  const sideReason = (playerId: string, sectionId: number, stageRevealed: boolean) =>
    visibilityReason({ stageRevealed, isSelf: viewerId === playerId, seal: seals.sealFor(playerId, sectionId) });
  const sideVisible = (playerId: string, sectionId: number, stageRevealed: boolean) =>
    sideReason(playerId, sectionId, stageRevealed) !== "hidden";

  for (const section of layout.sections) {
    const stageLabel = section.name.split(" | ")[0];
    for (const group of section.groups) {
      const gKey = `${section.sectionid}:${group.groupid}`;
      const revealed = arePicksRevealed(
        group,
        groupHasOutcome.has(groupOutcomeKey(section.sectionid, group.groupid)),
        isLockTimePassed(section.sectionid, nowMs, event.lockSchedule),
        eventArchived,
      );
      revealedByGroup.set(gKey, revealed);
      // Per-side visibility (pick-lock-core): stage lock, self, or a public seal.
      // Only groups where BOTH sides are visible feed the agreement / steal maths.
      if (!sideVisible(aId, section.sectionid, revealed) || !sideVisible(bId, section.sectionid, revealed)) continue;

      const aGroup = aPicksMap[section.sectionid]?.[group.groupid] ?? {};
      const bGroup = bPicksMap[section.sectionid]?.[group.groupid] ?? {};
      const groupOutcomes = outcomeMap[section.sectionid]?.[group.groupid] ?? {};

      // Judge picks at BUCKET grain for Swiss (#946): within a 3:0 / advance /
      // 0:3 bucket the slots are interchangeable, so a team that landed in the
      // bucket counts no matter which slot row its winner occupies — same grain
      // scoring.ts uses. Playoffs collapse to one single-slot bucket per match
      // (a match's winner is strict per slot). The bucket also tags the steal's
      // label ("Stage I · 3:0") — the bucket is the story, not slot N of 10.
      const isSwiss = isSwissSection(section.sectionid);
      const buckets = isSwiss
        ? bucketSwissSlots(group.picks.length)
        : group.picks.map((p) => ({ label: "", slotIndexes: [p.index] }));

      for (const bucket of buckets) {
        const aPicked = new Set(bucket.slotIndexes.map((i) => aGroup[i]).filter((x) => x && x !== 0));
        const bPicked = new Set(bucket.slotIndexes.map((i) => bGroup[i]).filter((x) => x && x !== 0));
        compared += Math.min(aPicked.size, bPicked.size);
        for (const t of aPicked) if (bPicked.has(t)) agreed++;

        const { winners } = resolveBucketWinners(bucket.slotIndexes, groupOutcomes);
        if (winners.size === 0) continue; // nothing resolved in this bucket yet
        const label = isSwiss ? `${stageLabel} · ${bucketTitle(bucket.label)}` : stageLabel;
        for (const winner of winners) {
          const winTeam = team(winner);
          if (!winTeam) continue;
          const aRight = aPicked.has(winner);
          const bRight = bPicked.has(winner);
          if (aRight && bRight) bothRight++;
          else if (aRight) aSteals.push({ team: winTeam, label });
          else if (bRight) bSteals.push({ team: winTeam, label });
        }
      }
    }
  }

  // Who has shared calls early — a PUBLIC seal on a stage that hasn't locked
  // yet. Surfaced in the "under wraps" state so the room can find them.
  const unitRevealed = (unit: number) => {
    const sec = layout.sections.find((s) => s.sectionid === unit);
    return !!sec && sec.groups.every((g) => revealedByGroup.get(`${unit}:${g.groupid}`));
  };
  const sharedEarly = archive
    ? []
    : players.filter(
        (p) => p.id !== aId && seals.rows.some((r) => r.playerId === p.id && isPublicSeal(r) && !unitRevealed(r.sectionId)),
      );

  const resolvedAny = aSteals.length + bSteals.length + bothRight > 0;
  const agreePct = compared > 0 ? Math.round((agreed / compared) * 100) : 0;

  // Hero name sizing (Brandon): names are ALWAYS fully visible up to
  // NAME_FIT_MAX chars — the type scales to its column by length and may wrap
  // to two lines; never an ellipsis. See lib/name-fit.ts + sg-compare.css.
  // Both names are sized off the longer one so the duel stays balanced (a
  // 5-char name doesn't tower over a 12-char one); floor of 8 caps short pairs.
  const duelChars = Math.max(nameLineChars(a.displayName), nameLineChars(b.displayName), 8);
  const side = (p: PlayerLite, score: number, you: boolean, align: "l" | "r") => {
    const rank = rankOf(p.id);
    const fit = nameFit(p.displayName, "cmp-big");
    fit.style = { ...fit.style, ["--nf-chars" as string]: duelChars };
    return (
      <div className={`cmp-p ${align}`}>
        <span className="cmp-tag">
          <RankAvatar name={p.displayName} avatarUrl={p.avatarUrl} size={32} />
          <span className="eyebrow">
            #{String(rank).padStart(2, "0")}
            {you && (
              <>
                {" "}
                · <b>you</b>
              </>
            )}{" "}
            · {provenance(p)}
          </span>
        </span>
        <span className={fit.className} style={fit.style} title={p.displayName}>
          {p.displayName}
        </span>
        <span className="cmp-pts">
          <b>{score}</b> pts
        </span>
      </div>
    );
  };

  const stealCard = (steals: { team: TeamDef; label: string }[], who: string, other: string, win: boolean) => (
    <div className={`cmp-st${steals.length ? (win ? " win" : " loss") : ""}`}>
      <span className="cmp-st-who">
        {who} called it · {other} didn&apos;t — {steals.length}
      </span>
      {steals.length ? (
        <ul className="cmp-st-list">
          {steals.map((s, i) => (
            <li key={i}>
              <TeamLogo tiers={resolveLogoTiers(s.team)} teamName={s.team.name} size={40} />
              <span>
                <b>{s.team.name}</b>
                <span className="cmp-st-l">{s.label}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>Nothing yet.</p>
      )}
    </div>
  );

  return (
    <div className="rk-page">
      <section className="bleed cmp-hero">
        <Image src={PHOTOS.compareHero} alt="" fill priority sizes="100vw" />
        <span className="credit">Photo · IEM Cologne Major 2026 · HLTV</span>
        <div className="in">
          <Link href={boardHref} prefetch={false} className="eyebrow cmp-back">
            ← {archive ? `Final standings · ${eventName}` : "Leaderboard"}
          </Link>
          <span className="eyebrow rise">
            Head to head · <b>{eventName}</b>
            {archive ? " · final" : ""}
          </span>
          <h1 className="rk-sr">Compare</h1>
          <div className="cmp-duel rise d1">
            {side(a, aScore, aIsYou, "l")}
            <span className="cmp-x" aria-label={lead === 0 ? "Tied" : `${lead > 0 ? aName : b.displayName} leads by ${Math.abs(lead)}`}>
              <span className="cmp-vs" aria-hidden>
                VS
              </span>
              <span className={`cmp-lead${lead === 0 ? "" : " on"}`} aria-hidden>
                {lead === 0 ? "Tied" : lead > 0 ? `← +${lead}` : `+${-lead} →`}
              </span>
            </span>
            {side(b, bScore, bIsYou, "r")}
          </div>
        </div>
      </section>

      {/* Agreement strip */}
      <section className="chap">
        <div className="chap-h">
          <h2>{compared === 0 ? "Calls under wraps" : agreePct >= 60 ? "Same brain, mostly" : agreePct >= 40 ? "Split down the middle" : "Different reads"}</h2>
          <p>
            {compared === 0 ? (
              <>
                Picks reveal as each stage locks — then you&apos;ll see every call you share. Anyone who{" "}
                <b>seals their picks public</b> shows them early.
              </>
            ) : (
              <>
                {aIsYou ? "You" : a.displayName} and {b.displayName} agreed on <b>{agreed} of {compared}</b> revealed
                calls. The rest decide it.
              </>
            )}
          </p>
          {compared === 0 && sharedEarly.length > 0 && (
            <>
              <span className="sgs-mark" style={{ marginTop: 14 }}>
                <EyeIcon size={12} /> Shared early · {sharedEarly.length} player{sharedEarly.length === 1 ? "" : "s"}
              </span>
              <div className="cmp-shared">
                {sharedEarly.map((p) => (
                  <Link key={p.id} href={compareHref(aId, p.id)} prefetch={false} aria-current={p.id === bId ? "true" : undefined}>
                    <RankAvatar name={p.displayName} avatarUrl={p.avatarUrl} size={22} />
                    {p.displayName}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
        {compared > 0 && (
          <div className="cmp-meter" role="img" aria-label={`${agreed} of ${compared} calls in common`}>
            <div className="cmp-bar">
              <i style={{ width: `${agreePct}%` }} />
              <u style={{ width: `${100 - agreePct}%` }} />
            </div>
            <div className="cmp-lg">
              <span>{agreed} in common</span>
              <span>{compared - agreed} split</span>
            </div>
          </div>
        )}
      </section>

      {/* THE STEAL — picks called right that the other whiffed */}
      <section className="chap">
        <div className="chap-h row2">
          <div>
            <h2>The steal</h2>
          </div>
          {resolvedAny && (
            <span className="eyebrow">
              {aSteals.length}–{bSteals.length} · {bothRight} shared
            </span>
          )}
        </div>
        {!resolvedAny ? (
          <p className="rk-note">
            No results in yet. The moment matches resolve, the picks {aIsYou ? "you" : a.displayName} nailed that{" "}
            {bIsYou ? "they" : b.displayName} missed land right here.
          </p>
        ) : (
          <div className="cmp-steal">
            {stealCard(aSteals, aName, b.displayName, true)}
            {stealCard(bSteals, b.displayName, aIsYou ? "you" : a.displayName, false)}
          </div>
        )}
      </section>

      {/* Rival picker — every other player as a full-name card (rank, points,
          gap to the left-hand player). Names wrap; nothing is truncated. */}
      <section className="chap" aria-labelledby="cmp-rivals-h">
        <div className="chap-h row2">
          <div>
            <h2 id="cmp-rivals-h">Compare against</h2>
          </div>
          <span className="eyebrow">
            {aIsYou ? "You" : a.displayName} vs <b>anyone</b> · {ranked.length - 1} rival{ranked.length - 1 !== 1 ? "s" : ""}
          </span>
        </div>
        <ul className="cmp-rivals">
          {ranked
            .filter((r) => r.player.id !== aId)
            .map(({ player: p, score }) => {
              const on = p.id === bId;
              const gap = score - aScore;
              const gapLabel = gap === 0 ? "level" : gap > 0 ? `+${gap}` : `−${-gap}`;
              const gapWords =
                gap === 0
                  ? `level with ${aIsYou ? "you" : a.displayName}`
                  : `${Math.abs(gap)} ${gap > 0 ? "ahead of" : "behind"} ${aIsYou ? "you" : a.displayName}`;
              return (
                <li key={p.id}>
                  <Link
                    href={compareHref(aId, p.id)}
                    prefetch={false}
                    scroll={false}
                    className={`cmp-rival${on ? " on" : ""}`}
                    aria-current={on ? "true" : undefined}
                    aria-label={`${p.displayName}, rank ${rankOf(p.id)}, ${score} points, ${gapWords}${on ? " — selected" : ""}`}
                  >
                    <RankAvatar name={p.displayName} avatarUrl={p.avatarUrl} size={36} />
                    <span className="cmp-rival-id">
                      <span className="cmp-rival-nm">{p.displayName}</span>
                      <span className="cmp-rival-m">
                        #{String(rankOf(p.id)).padStart(2, "0")} · {score} pts
                        {p.id === session?.playerId ? " · you" : ""}
                      </span>
                    </span>
                    <span className={`cmp-rival-gap${gap > 0 ? " up" : gap < 0 ? " dn" : ""}`} aria-hidden>
                      {on ? "Selected" : gapLabel}
                    </span>
                  </Link>
                </li>
              );
            })}
        </ul>
      </section>

      {/* Side by side — per-stage, per-bucket split rows */}
      {layout.sections.map((section) => {
        const stageLabel = section.name.split(" | ")[0];
        const isSwiss = isSwissSection(section.sectionid);
        // "Sealed early · public" markers — only while the stage itself is
        // still under wraps (after lock everyone's calls show anyway).
        const stageOpen = !section.groups.every((g) => revealedByGroup.get(`${section.sectionid}:${g.groupid}`));
        const marks = stageOpen
          ? [
              { id: aId, name: aIsYou ? "You" : a.displayName },
              { id: bId, name: bIsYou ? "You" : b.displayName },
            ]
              .map((p) => ({ ...p, seal: seals.sealFor(p.id, section.sectionid) }))
              .filter((p) => isPublicSeal(p.seal))
          : [];
        return (
          <section key={section.sectionid} className="chap">
            <div className="chap-h">
              <h2>{stageLabel}</h2>
              {marks.length > 0 && (
                <div className="sgs-marks">
                  {marks.map((m) => (
                    <span key={m.id} className="sgs-mark">
                      <EyeIcon size={12} /> {m.name} · sealed early · public
                      {m.seal?.steamDivergedAt && <span className="sgs-mark warn"> · changed in-game after sealing</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {section.groups.map((group) => {
              const stageRevealed = revealedByGroup.get(`${section.sectionid}:${group.groupid}`) ?? false;
              const aReason = sideReason(aId, section.sectionid, stageRevealed);
              const bReason = sideReason(bId, section.sectionid, stageRevealed);
              // The grid opens once the stage locks, or early when either side
              // sealed public. A side that's still under wraps is masked HERE, on
              // the server — its picks never reach the rendered output.
              const revealed = stageRevealed || aReason === "public-seal" || bReason === "public-seal";
              const aHidden = aReason === "hidden";
              const bHidden = bReason === "hidden";
              const aGroup = aHidden ? {} : (aPicksMap[section.sectionid]?.[group.groupid] ?? {});
              const bGroup = bHidden ? {} : (bPicksMap[section.sectionid]?.[group.groupid] ?? {});
              const groupOutcomes = outcomeMap[section.sectionid]?.[group.groupid] ?? {};
              // Read-only on resolution applies to SWISS only. The playoff bracket
              // resolves match-by-match while it's still the live event everyone is
              // reacting to (#1262) — gating those per-match would silently kill
              // reactions on each QF/SF as it finishes. Keep playoff picks reactable.
              const groupClosed = isSwiss && Object.keys(groupOutcomes).length >= group.picks.length;
              const ppp = `${group.points_per_pick} pt${group.points_per_pick !== 1 ? "s" : ""} / pick`;

              if (!revealed) {
                return (
                  <div key={group.groupid} className="cmp-grp">
                    <div className="cmp-gh">
                      <h3>{group.name.split(" | ").slice(-1)[0]}</h3>
                      <span>{ppp}</span>
                    </div>
                    <p className="cmp-locked">
                      <LockIcon size={11} />{" "}Both players&apos; picks unlock when this stage starts — or as soon as
                      one seals them public
                    </p>
                  </div>
                );
              }

              // Swiss stages split into the 2 / 6 / 2 buckets (3:0 advance,
              // advancing, 0:3 out) — the real structure, not a flat 1-10.
              const buckets = isSwiss
                ? bucketSwissSlots(group.picks.length)
                : [{ label: group.name.split(" | ").slice(-1)[0], slotIndexes: group.picks.map((p) => p.index) }];

              return (
                <div key={group.groupid} className={`cmp-grps${isSwiss && buckets.length === 3 ? " swiss" : ""}`}>
                  {buckets.map((bucket) => {
                    // Swiss → judge the whole bucket as a set (#946);
                    // playoffs → each slot is its own match, resolved per row.
                    const swissRes = isSwiss ? resolveBucketWinners(bucket.slotIndexes, groupOutcomes) : null;
                    const aBucketPicked = isSwiss
                      ? new Set(bucket.slotIndexes.map((i) => aGroup[i]).filter((x) => x && x !== 0))
                      : null;
                    const bBucketPicked = isSwiss
                      ? new Set(bucket.slotIndexes.map((i) => bGroup[i]).filter((x) => x && x !== 0))
                      : null;

                    // Row pairing. Swiss slots within a bucket are interchangeable,
                    // so line shared teams up first, then the split calls. Playoff
                    // rows stay slot-for-slot (each slot is one match).
                    type Pair = { aSlot: number; bSlot: number };
                    let pairs: Pair[];
                    if (isSwiss) {
                      const aSlots = [...bucket.slotIndexes];
                      const bSlots = [...bucket.slotIndexes];
                      pairs = [];
                      for (const s of [...aSlots]) {
                        const pick = aGroup[s];
                        if (!pick) continue;
                        const j = bSlots.findIndex((t) => bGroup[t] === pick);
                        if (j < 0) continue;
                        pairs.push({ aSlot: s, bSlot: bSlots[j] });
                        aSlots.splice(aSlots.indexOf(s), 1);
                        bSlots.splice(j, 1);
                      }
                      aSlots.forEach((s, i) => pairs.push({ aSlot: s, bSlot: bSlots[i] }));
                    } else {
                      pairs = bucket.slotIndexes.map((s) => ({ aSlot: s, bSlot: s }));
                    }
                    const same = pairs.filter((p) => aGroup[p.aSlot] && aGroup[p.aSlot] === bGroup[p.bSlot]).length;

                    const recs = isSwiss ? recordsBySection.get(section.sectionid) : undefined;
                    const stateFor = (pick: number | undefined, slotIndex: number) => {
                      const res = swissRes ?? resolveBucketWinners([slotIndex], groupOutcomes);
                      // Early-red (#951): a 3:0/0:3 pick whose team's partial
                      // record already rules its bucket out is a miss now, before
                      // the answer key resolves it. Swiss only.
                      const impossible = !!pick && isBucketImpossibleByRecord(bucket.label, recs?.get(pick));
                      return bucketPickState(pick, res, impossible);
                    };

                    return (
                      <div key={bucket.label} className="cmp-grp">
                        <div className="cmp-gh">
                          <h3>{isSwiss ? bucketTitle(bucket.label) : bucket.label}</h3>
                          <span>
                            {aHidden || bHidden ? ppp : `${same}/${pairs.length} same · ${ppp}`}
                          </span>
                        </div>
                        {pairs.map(({ aSlot, bSlot }) => {
                          const aPick = aGroup[aSlot];
                          const bPick = bGroup[bSlot];
                          const aScope = aBucketPicked ?? new Set([aPick].filter((x) => x && x !== 0));
                          const bScope = bBucketPicked ?? new Set([bPick].filter((x) => x && x !== 0));
                          const aState = stateFor(aPick, aSlot);
                          const bState = stateFor(bPick, bSlot);
                          // Steal = you hit a team your opponent never picked (in scope).
                          const aSteal = aState === "hit" && aPick !== undefined && !bScope.has(aPick);
                          const bSteal = bState === "hit" && bPick !== undefined && !aScope.has(bPick);
                          const isSame = !!aPick && aPick === bPick;
                          return (
                            <div key={`${aSlot}-${bSlot}`} className={`cmp-cr${isSame ? " same" : ""}`}>
                              <div className="cmp-cell">
                                <PickSide team={team(aPick)} state={aState} steal={aSteal} hidden={aHidden} />
                                {aPick && aPick !== 0 && (
                                  <BleachersStrip
                                    targetPlayerId={aId}
                                    sectionId={section.sectionid}
                                    groupId={group.groupid}
                                    slotIndex={aSlot}
                                    initialTally={tallyFor(aId, section.sectionid, group.groupid, aSlot)}
                                    canReact={canReactA && !groupClosed}
                                  />
                                )}
                              </div>
                              {aHidden || bHidden ? (
                                <span className="cmp-m" aria-hidden="true">
                                  ·
                                </span>
                              ) : (
                                <span className="cmp-m" aria-label={isSame ? "same pick" : "different pick"}>
                                  {isSame ? "=" : "≠"}
                                </span>
                              )}
                              <div className="cmp-cell r">
                                <PickSide team={team(bPick)} state={bState} steal={bSteal} hidden={bHidden} />
                                {bPick && bPick !== 0 && (
                                  <BleachersStrip
                                    targetPlayerId={bId}
                                    sectionId={section.sectionid}
                                    groupId={group.groupid}
                                    slotIndex={bSlot}
                                    initialTally={tallyFor(bId, section.sectionid, group.groupid, bSlot)}
                                    canReact={canReactB && !groupClosed}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        );
      })}

      <section className="cta">
        <Link href={boardHref} prefetch={false} className="btn-ghost">
          Back to ranks
        </Link>
      </section>
    </div>
  );
}
