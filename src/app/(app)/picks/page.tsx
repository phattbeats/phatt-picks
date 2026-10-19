import Link from "next/link";
import { buildTeamMap } from "@/lib/layout";
import { getEffectiveLayout, refreshLayoutOnRead } from "@/lib/layout-state";
import { getSession } from "@/lib/session";
import { hasAuthCode } from "@/lib/authcode";
import { prisma } from "@/lib/db";
import { mirrorPlayerPredictionsThrottled } from "@/lib/predictions-sync";
import { PicksBoard } from "@/components/PicksBoard";
import {
  isStagePickable,
  selectCurrentStageIndex,
  type StagePickability,
} from "@/lib/stage-gate-core";
import { LockCountdown } from "@/components/heat/LockCountdown";
import { PlayoffScheduleStrip } from "@/components/heat/PlayoffScheduleStrip";
import { lockTimeForSection, isLockTimePassed, isBracketRevealed, playoffGameTime } from "@/lib/lock-schedule-core";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { isSwissSection, bucketSwissSlots } from "@/lib/swiss-bucket-core";
import {
  isPlayoffSection,
  buildPlayoffBracket,
  buildPlayoffPickTree,
  PLAYOFF_ROUNDS,
} from "@/lib/playoff-bracket-core";
import { LockIcon } from "@/components/ui/LockIcon";
import { LivePlayoffBracket } from "@/components/heat/LivePlayoffBracket";
import { PlayoffBracketPicker } from "@/components/heat/PlayoffBracketPicker";
import { QualifiedStrip } from "@/components/ui/QualifiedStrip";
import { buildSwissStandings, type SlotPickMap } from "@/lib/swiss-standings-core";
import { stageWrappedHasContent } from "@/lib/stage-wrapped-content";
import { stageNumeral } from "@/lib/stage-wrapped-core";
import { LockedPicksBoard } from "@/components/heat/LockedPicksBoard";
import { LiveSwissStandings } from "@/components/heat/LiveSwissStandings";
import { LiveSwissBracketBoard } from "@/components/heat/LiveSwissBracketBoard";
import { refreshStandingsOnRead, getSwissStandings, getSwissBracket } from "@/lib/swiss-results";
import { recordsByPickId } from "@/lib/swiss-results-core";
import { refreshTeamStatsOnRead, getLiveTeamStats } from "@/lib/team-stats";
import { refreshSpotlightOddsOnRead, getSpotlightMarket } from "@/lib/spotlight-odds";
import { AutoRefresh } from "@/components/AutoRefresh";
import { currentEventId, getEventConfig, stageOneStartFor } from "@/lib/events-core";
import { scorePlayer, type OutcomeMap } from "@/lib/scoring";
import { StageHeader } from "@/components/sg/picks/StageHeader";
import { StageTabs, type StageTab } from "@/components/sg/picks/StageTabs";
import { getSeal, toSealView } from "@/lib/pick-lock";
import { PHOTOS } from "@/lib/photos";

export const dynamic = "force-dynamic";

export default async function PicksPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  // Per-request active event (#1046) — force-dynamic, follows the clock across Majors.
  const EVENT_ID = currentEventId();
  const event = getEventConfig(EVENT_ID);
  const params = await searchParams;
  await refreshLayoutOnRead(EVENT_ID); // live driver — throttled, deferred past render
  const layout = await getEffectiveLayout(EVENT_ID);
  const session = await getSession();

  // Pre-open: Valve hasn't opened this Major's Pick'Em (no layout). There are no
  // stages or teams to show, and nothing to sync. Show an honest "not open"
  // screen with the Stage I countdown, not the previous Major's field.
  if (!layout) {
    return <PicksNotOpen event={event} signedIn={!!session} />;
  }

  if (session?.steamId) {
    await mirrorPlayerPredictionsThrottled(session.playerId, EVENT_ID);
  }

  // Live driver (#866/898): keep the answer key fresh so a locked stage's
  // lineup tracks results as teams clinch. Atomic 30s claim, deferred ingest.
  await refreshOutcomesOnRead(EVENT_ID);

  // Per-request server clock — this is a force-dynamic RSC rendered once per
  // request, so reading the time to evaluate the published lock schedule is
  // intentional (mirrors the dashboard).
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  // Live team-dossier refresh (#921): keep each team's "Last 5 matches" fresh
  // per stage. Atomic ~1h claim, deferred batch crawl, gated to match windows —
  // off-days no-op. The merged read below feeds the [i] dossier; off-window /
  // cold start falls back to the committed frozen snapshot (never empty).
  await refreshTeamStatsOnRead(EVENT_ID, nowMs);

  // Live playoff Spotlight odds refresh (#1066): same on-read, ~1h-claimed,
  // deferred pattern as the dossier, but the source is Polymarket's gamma-api.
  // Gated to an authored matchup registry (empty until Valve seeds the bracket),
  // so this is a no-op until a real playoff matchup exists to target.
  await refreshSpotlightOddsOnRead(EVENT_ID, nowMs);

  // Signed in via Steam but no auth code yet: picks save in HOTLINE, but we
  // can't push them to the official in-game CS2 Pick'Em until they connect a
  // Game Authentication Code. Surface that gap up front with a link (#891).
  const needsSteamLink = session?.steamId
    ? !(await hasAuthCode(session.playerId))
    : false;

  // Scheduled hard lock (#886/898): once a stage's first match starts, its
  // pick window is closed — even though the committed layout still says
  // picks_allowed and an outcome row hasn't landed yet. The published schedule
  // is the truthful signal; the gate surfaces `locked-time-passed` (friendlier
  // copy that introduces the live lineup below) and POST /api/picks mirrors the
  // same lock. Playoffs have no published time (null) → unaffected. Computed
  // once in layout order, then keyed by id for the tab/lock rendering below.
  const orderedPickability = layout.sections.map((s) =>
    isStagePickable(layout, s.sectionid, {
      lockedByTime: isLockTimePassed(s.sectionid, nowMs, event?.lockSchedule),
    }),
  );
  const sectionPickability: Map<number, StagePickability> = new Map(
    layout.sections.map((s, i) => [s.sectionid, orderedPickability[i]]),
  );

  // #1050: clicking "Picks" with no ?section lands on the event's CURRENT
  // stage — the one open for picks, else the latest stage underway — instead of
  // always Stage I. Same "current stage" rule the dashboard hero uses, so the
  // nav and the briefing always agree on what "now" is. An explicit ?section
  // (a tab click, a deep link) still wins.
  const defaultSectionId =
    layout.sections[selectCurrentStageIndex(orderedPickability)]?.sectionid ??
    layout.sections[0].sectionid;

  const activeSectionId = params.section
    ? parseInt(params.section, 10)
    : defaultSectionId;

  const section = layout.sections.find((s) => s.sectionid === activeSectionId);
  const activePickability =
    sectionPickability.get(activeSectionId) ??
    ({ pickable: false, reason: "unknown-section" } as StagePickability);

  // #1016: the playoffs are ONE pick'em stage — quarters, semis and the
  // Grand Final all open and lock together when Valve seeds the bracket. The
  // UI matches that truth: a single "Playoffs" tab covering all three layout
  // sections, with the round pickers stacked above the full bracket.
  const playoffSectionIds = PLAYOFF_ROUNDS.map((r) => r.sectionId);
  const playoffSections = layout.sections.filter((s) =>
    playoffSectionIds.includes(s.sectionid),
  );
  const playoffActive = isPlayoffSection(activeSectionId);
  const anyPlayoffPickable = playoffSections.some(
    (s) => sectionPickability.get(s.sectionid)?.pickable,
  );
  // True once Valve has seeded at least one playoff slot (pickid > 0). Before
  // seeding every section has reason "teams-not-set"; after lock the reason is
  // "locked-time-passed" or "locked-by-valve" — still seeded.
  const playoffSeeded = playoffSections.some((s) => {
    const p = sectionPickability.get(s.sectionid);
    return p?.reason === "locked-time-passed" || p?.reason === "locked-by-valve" || p?.pickable;
  });

  // Per-game playoff schedule (#1007): each round's games with their committed
  // date/time, fed to the schedule strip. Dark until COLOGNE_PLAYOFF_SCHEDULE is
  // filled (the strip renders nothing while every iso is null).
  const playoffScheduleRounds = PLAYOFF_ROUNDS.map((def) => {
    const sec = playoffSections.find((s) => s.sectionid === def.sectionId);
    const games = (sec?.groups ?? []).map((_g, i) => ({
      label: def.key === "GF" ? "Grand Final" : `Match ${i + 1}`,
      iso: playoffGameTime(def.sectionId, i, event?.playoffSchedule),
    }));
    return { short: def.short, label: def.label, games };
  });

  const myPicks: Record<number, Record<number, number>> = {};
  // #1214: true when every non-empty pick this stage holds is already on
  // Steam (isLocal === false) — drives the Lock In button green on page load
  // and keeps it green across reloads until the player changes a pick.
  let mySectionSynced = false;
  if (session) {
    const picks = await prisma.pick.findMany({
      where: { playerId: session.playerId, eventId: EVENT_ID, sectionId: activeSectionId },
    });
    for (const pick of picks) {
      myPicks[pick.groupId] ??= {};
      myPicks[pick.groupId][pick.slotIndex] = pick.pickId;
    }
    const placed = picks.filter((p) => p.pickId !== 0);
    mySectionSynced = placed.length > 0 && placed.every((p) => !p.isLocal);
  }

  // The viewer's self-seal on the active stage (pick-lock-core). Playoff rounds
  // resolve onto the one bracket unit, so any playoff tab finds it.
  const mySeal = session ? toSealView(await getSeal(session.playerId, EVENT_ID, activeSectionId)) : null;

  // Live Swiss lineup (#898): once a Swiss stage locks we show the standings
  // in place of the picker. Build it from the resolved answer key + the viewer's
  // picks. Only fetch when we'd actually render it (locked Swiss section).
  const isSwiss = isSwissSection(activeSectionId);
  const showLineup = !!section && !activePickability.pickable && isSwiss;
  // #943: the live Swiss bracket goes live 24h before the stage's lock (= its
  // first match) — so the opening matchups are visible the day before, while
  // picks are STILL open — and stays up after lock. Before that reveal instant we
  // don't render it (and the crawl is gated off). Playoff sections have no lock
  // time → isBracketRevealed is false; they render via the playoff branch below.
  const bracketRevealed = isBracketRevealed(activeSectionId, nowMs, event?.lockSchedule);
  const showLiveBracket = !!section && isSwiss && (showLineup || bracketRevealed);
  const matchTeams = layout.teams.map((t) => ({ pickid: t.pickid, name: t.name }));

  let swissStandings: ReturnType<typeof buildSwissStandings> | null = null;
  let outcomeResolvedAtIso: string | null = null;
  // Whether this Swiss stage is OVER (every slot resolved), not merely locked /
  // underway — drives the "stage complete" copy + the Stage Wrapped entry below.
  let stageComplete = false;
  // Live HLTV/BLAST-style W-L standings (#902): the running win-loss table the
  // Valve answer key can't provide. Hourly on-read refresh, graceful-empty.
  let liveStandings: Awaited<ReturnType<typeof getSwissStandings>> = null;
  let liveBracket: Awaited<ReturnType<typeof getSwissBracket>> = null;

  // The bracket (the fan of matchups) AND the W-L standings table both go live
  // from the reveal instant on — pre- and post-lock (Brandon, #943: "and the
  // standings as well for stage II and III"). Both come from the same HLTV crawl,
  // whose refresh window opens at the same instant, so they appear together the
  // moment HLTV publishes the field.
  if (showLiveBracket && section) {
    await refreshStandingsOnRead(EVENT_ID, activeSectionId, nowMs); // ~1h claim, deferred crawl
    liveBracket = await getSwissBracket(EVENT_ID, activeSectionId, matchTeams);
    liveStandings = await getSwissStandings(EVENT_ID, activeSectionId, matchTeams);
  }

  // The viewer's locked-picks board + the resolved answer key are the post-lock
  // lineup — only built once the stage actually locks.
  if (showLineup && section) {
    const outcomeRows = await prisma.stageOutcome.findMany({
      where: { eventId: EVENT_ID, sectionId: activeSectionId },
    });
    const outcomesForSection: Record<number, Record<number, number>> = {};
    let latest = 0;
    for (const o of outcomeRows) {
      outcomesForSection[o.groupId] ??= {};
      outcomesForSection[o.groupId][o.slotIndex] = o.winnerPickId;
      const t = o.resolvedAt.getTime();
      if (t > latest) latest = t;
    }
    outcomeResolvedAtIso = latest > 0 ? new Date(latest).toISOString() : null;
    // The stage is OVER when every Swiss slot has a resolved winner (full answer
    // key), vs. merely locked while matches are still being played.
    stageComplete = section.groups.every((g) =>
      g.picks.every((slot) => outcomesForSection[g.groupid]?.[slot.index] !== undefined),
    );
    swissStandings = buildSwissStandings(
      section,
      outcomesForSection as SlotPickMap,
      bucketSwissSlots,
      myPicks as SlotPickMap,
    );
  }

  // Live playoffs bracket (#903): the single-elim QF → SF → GF tree. Unlike
  // the Swiss bracket (an HLTV crawl), the playoff TREE is fully described by our
  // layout — it just fills in live as Stage 3 resolves: seeded teams arrive on
  // the layout team slots, winners arrive as StageOutcome rows. We always render
  // the WHOLE tree (all three playoff sections) regardless of which playoff tab
  // is open, matching Brandon's reference. Built only when viewing a playoff tab.
  let playoffBracket: ReturnType<typeof buildPlayoffBracket> | null = null;
  let playoffResolvedAtIso: string | null = null;
  // #1204: the predictor model (QF→SF→GF feed tree) + the viewer's saved
  // winner per match, keyed by groupId (slot 0). Feeds the single interactive
  // bracket that replaces the stacked round-pickers.
  let playoffPickModel: ReturnType<typeof buildPlayoffPickTree> | null = null;
  const playoffInitialPicks: Record<number, number> = {};
  // #1214: every saved bracket pick already on Steam → Lock In stays green.
  let playoffSynced = false;
  if (playoffActive) {
    // Viewer's call per match (one pick slot per match group, slot 0).
    const userPickByGroup = new Map<number, number>();
    if (session) {
      const myPlayoffPicks = await prisma.pick.findMany({
        where: { playerId: session.playerId, eventId: EVENT_ID, sectionId: { in: playoffSectionIds } },
      });
      for (const p of myPlayoffPicks) {
        if (p.slotIndex === 0 && p.pickId !== 0) {
          userPickByGroup.set(p.groupId, p.pickId);
          playoffInitialPicks[p.groupId] = p.pickId;
        }
      }
      const placed = myPlayoffPicks.filter((p) => p.pickId !== 0);
      playoffSynced = placed.length > 0 && placed.every((p) => !p.isLocal);
    }
    playoffPickModel = buildPlayoffPickTree(playoffSections);
    // Resolved winners per match.
    const winnerByGroup = new Map<number, number>();
    const playoffOutcomes = await prisma.stageOutcome.findMany({
      where: { eventId: EVENT_ID, sectionId: { in: playoffSectionIds } },
    });
    let latest = 0;
    for (const o of playoffOutcomes) {
      if (o.slotIndex === 0) winnerByGroup.set(o.groupId, o.winnerPickId);
      const t = o.resolvedAt.getTime();
      if (t > latest) latest = t;
    }
    playoffResolvedAtIso = latest > 0 ? new Date(latest).toISOString() : null;
    playoffBracket = buildPlayoffBracket({ sections: playoffSections, userPickByGroup, winnerByGroup, nowMs, playoffSchedule: event?.playoffSchedule });
  }

  // Live dossier map for the picker's [i] affordance (#921). Only read when
  // the picker is actually shown; the merged map overrides each team's recent[]
  // with live results while keeping roster/rank frozen, and is null off-window /
  // cold (the drawer then uses the committed snapshot).
  const liveTeamStats =
    activePickability.pickable || (playoffActive && anyPlayoffPickable)
      ? await getLiveTeamStats(EVENT_ID)
      : null;

  // Live market lines for the playoff Spotlight (#1066). Playoff-only — the
  // Spotlight modal is the only place that renders a market bar. Empty {} until a
  // matchup is authored, in which case the modal shows its "coming soon" state.
  const spotlightMarket = playoffActive ? await getSpotlightMarket(EVENT_ID, nowMs) : undefined;

  // Tab sub-lines + header result (Singapore §3): the viewer's progress per
  // stage while open, and their scored points once outcomes land. Read-only —
  // scored with the same engine as the leaderboard (scorePlayer).
  const filledBySection = new Map<number, number>();
  const scoreBySection = new Map<number, { points: number; correct: number; possible: number }>();
  if (session) {
    const [allMyPicks, eventOutcomes] = await Promise.all([
      prisma.pick.findMany({
        where: { playerId: session.playerId, eventId: EVENT_ID },
        select: { sectionId: true, groupId: true, slotIndex: true, pickId: true },
      }),
      prisma.stageOutcome.findMany({
        where: { eventId: EVENT_ID },
        select: { sectionId: true, groupId: true, slotIndex: true, winnerPickId: true },
      }),
    ]);
    const picksBySection: Record<number, Record<number, Record<number, number>>> = {};
    for (const p of allMyPicks) {
      if (p.pickId === 0) continue;
      filledBySection.set(p.sectionId, (filledBySection.get(p.sectionId) ?? 0) + 1);
      ((picksBySection[p.sectionId] ??= {})[p.groupId] ??= {})[p.slotIndex] = p.pickId;
    }
    const outcomeMap: OutcomeMap = {};
    for (const o of eventOutcomes) {
      ((outcomeMap[o.sectionId] ??= {})[o.groupId] ??= {})[o.slotIndex] = o.winnerPickId;
    }
    for (const row of scorePlayer(layout, picksBySection, outcomeMap).bySection) {
      scoreBySection.set(row.sectionId, row);
    }
  }
  const slotCount = (secs: typeof layout.sections) =>
    secs.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.picks.length, 0), 0);
  const sumOver = (ids: number[], f: (id: number) => number) => ids.reduce((n, id) => n + f(id), 0);

  // Header: the consolidated Playoffs tab reads as one stage regardless of
  // which playoff section id is in the URL; Swiss stages keep their name.
  const activeLabel = playoffActive
    ? "Playoffs"
    : section?.name.split(" | ")[0] ?? "Picks";

  // ── Presentation (Singapore skin, HANDOFF §3) ─────────────────────────
  const lockTitleFor = (pick: StagePickability) =>
    pick.pickable
      ? undefined
      : pick.reason === "teams-not-set"
        ? "Locked — teams not set yet"
        : pick.reason === "locked-by-valve"
          ? "Locked by Valve"
          : "Locked";

  // Tab model (#1016): one tab per Swiss stage, then a single Playoffs tab —
  // quarters/semis/finals open and lock together as one pick'em stage.
  const tabSub = (opts: { pickable: boolean; notSeeded: boolean; filled: number; total: number; score?: { points: number; possible: number } }) => {
    if (opts.pickable) {
      return (
        <>
          <b>
            {opts.filled}/{opts.total}
          </b>{" "}
          · open
        </>
      );
    }
    if (opts.score && opts.score.possible > 0) {
      return (
        <>
          <b className="ok">+{opts.score.points}</b> scored
        </>
      );
    }
    return opts.notSeeded ? "Not open" : "Locked";
  };

  const tabs: StageTab[] = layout.sections
    .filter((s) => !isPlayoffSection(s.sectionid))
    .map((s) => {
      const pick = sectionPickability.get(s.sectionid)!;
      return {
        key: String(s.sectionid),
        href: `/picks?section=${s.sectionid}`,
        label: s.name.split(" | ")[0],
        active: !playoffActive && s.sectionid === activeSectionId,
        locked: !pick.pickable,
        upcoming: !pick.pickable && pick.reason === "teams-not-set",
        lockTitle: lockTitleFor(pick),
        sub: tabSub({
          pickable: pick.pickable,
          notSeeded: !pick.pickable && pick.reason === "teams-not-set",
          filled: filledBySection.get(s.sectionid) ?? 0,
          total: slotCount([s]),
          score: scoreBySection.get(s.sectionid),
        }),
      };
    });
  if (playoffSections.length > 0) {
    const repPick =
      sectionPickability.get(playoffSections[0].sectionid) ??
      ({ pickable: false, reason: "unknown-section" } as StagePickability);
    const ids = playoffSections.map((s) => s.sectionid);
    tabs.push({
      key: "playoffs",
      href: `/picks?section=${playoffSections[0].sectionid}`,
      label: "Playoffs",
      active: playoffActive,
      locked: !anyPlayoffPickable,
      upcoming: !anyPlayoffPickable && !playoffSeeded,
      lockTitle: anyPlayoffPickable ? undefined : lockTitleFor(repPick),
      sub: tabSub({
        pickable: anyPlayoffPickable,
        notSeeded: !playoffSeeded,
        // One saved winner per match (slot 0 of each group).
        filled: sumOver(ids, (id) => filledBySection.get(id) ?? 0),
        total: slotCount(playoffSections),
        score: {
          points: sumOver(ids, (id) => scoreBySection.get(id)?.points ?? 0),
          possible: sumOver(ids, (id) => scoreBySection.get(id)?.possible ?? 0),
        },
      }),
    });
  }

  // Stage header copy + lockbox.
  const activeScore = playoffActive
    ? {
        points: sumOver(playoffSectionIds, (id) => scoreBySection.get(id)?.points ?? 0),
        correct: sumOver(playoffSectionIds, (id) => scoreBySection.get(id)?.correct ?? 0),
        possible: sumOver(playoffSectionIds, (id) => scoreBySection.get(id)?.possible ?? 0),
      }
    : scoreBySection.get(activeSectionId);
  const ptsPerCall = section?.groups[0]?.points_per_pick;
  const isFirstSwiss =
    !playoffActive && layout.sections.find((s) => isSwissSection(s.sectionid))?.sectionid === activeSectionId;
  // Before a stage's first-match lock is published, Stage I counts down to the
  // event's registry start (the home page uses the same instant).
  const publishedLock = playoffActive
    ? lockTimeForSection(playoffSectionIds[0], event?.lockSchedule)
    : lockTimeForSection(activeSectionId, event?.lockSchedule);
  const registryStart = !publishedLock && isFirstSwiss && event ? stageOneStartFor(event) : null;
  const fallbackStart = registryStart && Date.parse(registryStart) > nowMs ? registryStart : null;
  const headerOpen = playoffActive ? anyPlayoffPickable : activePickability.pickable;
  const headerNotSeeded = playoffActive
    ? !playoffSeeded
    : !activePickability.pickable && activePickability.reason === "teams-not-set";

  const eyebrow = playoffActive ? (
    headerOpen ? (
      <>
        Playoffs · Single elimination · <b>open for calls</b>
      </>
    ) : headerNotSeeded ? (
      <>
        Playoffs · Eight remain · <b>not seeded yet</b>
      </>
    ) : (
      <>
        Playoffs · Single elimination · <b>locked</b>
      </>
    )
  ) : headerOpen ? (
    <>
      {activeLabel} · Swiss · <b>{ptsPerCall ?? 1} pt{ptsPerCall === 1 ? "" : "s"} per call</b>
    </>
  ) : headerNotSeeded ? (
    <>
      {activeLabel} · <b>not open yet</b>
    </>
  ) : stageComplete ? (
    <>
      {activeLabel} · Swiss · <b>locked &amp; scored</b>
    </>
  ) : (
    <>
      {activeLabel} · Swiss · <b>locked · in play</b>
    </>
  );

  const lockbox = headerOpen ? (
    publishedLock || fallbackStart ? (
      <LockCountdown
        variant="box"
        lockAt={publishedLock ?? fallbackStart}
        boxLabel={publishedLock ? "Locks in" : `${activeLabel} starts`}
      />
    ) : (
      <>
        <span className="k">Status</span>
        <span className="v sm">Open</span>
        <span className="k">Locks at the first match</span>
      </>
    )
  ) : activeScore && activeScore.possible > 0 ? (
    <>
      <span className="k">Result</span>
      <span className="v">
        {activeScore.correct}
        <small>/{playoffActive ? slotCount(playoffSections) : slotCount(section ? [section] : [])}</small>
      </span>
      <span className="k">+{activeScore.points} pts</span>
    </>
  ) : (
    <>
      <span className="k">Status</span>
      <span className="v sm">{headerNotSeeded ? "Not seeded" : "Locked"}</span>
    </>
  );

  const headerPhoto = playoffActive ? PHOTOS.picksPlayoffs : PHOTOS.picksHeader;
  // Room for a fixed bar: the Swiss action bar (signed in, open) or sign-in bar.
  const hasBar = !session || (!playoffActive && activePickability.pickable && !!section);

  return (
    <div className={`sgp-page${hasBar ? " with-bar" : ""}`}>
      <StageHeader photo={headerPhoto} eyebrow={eyebrow} title={activeLabel} lockbox={lockbox} />

      {/* Steam-connected but no auth code: picks live in HOTLINE, not yet
          pushed to the official in-game Pick'Em. Point them at the page. */}
      {needsSteamLink && <SteamLinkNotice />}

      {/* Sealed, then changed in the CS2 client (pick-lock-core): HOTLINE keeps
          the sealed set; say so plainly. Shown publicly next to the seal too. */}
      {mySeal?.steamDiverged && (
        <div className="sgp-note solo">
          <div>
            <span className="tag warn">Changed in-game after sealing</span>
            <h2>Steam no longer matches your sealed calls</h2>
            <p>
              Your in-game CS2 Pick&apos;Em changed after you sealed this stage. HOTLINE keeps and scores your{" "}
              <b>sealed set</b>, and the change is noted on your seal. <b>Lock in &amp; sync</b> pushes the sealed
              set back to Steam.
            </p>
          </div>
        </div>
      )}

      <StageTabs tabs={tabs} />

      {/* Stage content */}
      {!section ? (
        <p className="muted">Section not found.</p>
      ) : playoffActive ? (
        // Consolidated Playoffs view (#1016): one stage, one tab. When
        // Valve seeds + opens the bracket the three round pickers stack here
        // (they all lock together); until then an honest status strip. The
        // full QF → SF → GF tree renders beneath either way.
        <div className="sgp-stack rise d2">
          {anyPlayoffPickable && playoffPickModel ? (
            // #1204: picks OPEN — interactive QF→SF→GF bracket. Crown a
            // winner and they advance into the round they feed.
            <PlayoffBracketPicker
              model={playoffPickModel}
              teams={layout.teams}
              initialPicks={playoffInitialPicks}
              enabled={!!session}
              eventId={EVENT_ID}
              signedIn={!!session}
              steamLinked={!!session?.steamId}
              initiallySynced={playoffSynced}
              liveTeamStats={liveTeamStats?.byPickid}
              liveStatsAsOf={liveTeamStats?.asOf}
              spotlightMarket={spotlightMarket}
              initialSeal={mySeal}
            />
          ) : playoffSeeded ? (
            // #1263: bracket seeded + picks locked. Show the viewer's OWN
            // crowned bracket read-only (the interactive picker, enabled=false)
            // so their predicted QF→SF→GF run and "Your champion" stay on screen.
            // LivePlayoffBracket alone HID the crown ("cant see your crowned"):
            // it derives SF/GF from real outcomes, which lag until Valve advances
            // each round, so a viewer's downstream calls vanished. The live
            // results bracket stays beneath it so matches still resolve in view.
            <>
              <LockedStageCard pickability={activePickability} compact />
              {playoffPickModel && (
                <PlayoffBracketPicker
                  model={playoffPickModel}
                  teams={layout.teams}
                  initialPicks={playoffInitialPicks}
                  enabled={false}
                  eventId={EVENT_ID}
                  signedIn={!!session}
                  steamLinked={!!session?.steamId}
                  initiallySynced={playoffSynced}
                  liveTeamStats={liveTeamStats?.byPickid}
                  liveStatsAsOf={liveTeamStats?.asOf}
                  spotlightMarket={spotlightMarket}
                />
              )}
              {playoffBracket && (
                <LivePlayoffBracket
                  bracket={playoffBracket}
                  teamMap={buildTeamMap(layout)}
                  signedIn={!!session}
                  resolvedAtIso={playoffResolvedAtIso}
                />
              )}
            </>
          ) : (
            <>
              {/* #1043: before Valve seeds, the picker is empty, so a
                  "Qualified for Playoffs" strip surfaces clinched + authored
                  teams' Spotlights to build anticipation as the field is named.
                  The read-only bracket below shows the tree filling in live. */}
              <QualifiedStrip
                teams={layout.teams}
                liveTeamStats={liveTeamStats?.byPickid}
                liveStatsAsOf={liveTeamStats?.asOf}
              />
              <LockedStageCard pickability={activePickability} compact />
              {playoffBracket && (
                <LivePlayoffBracket
                  bracket={playoffBracket}
                  teamMap={buildTeamMap(layout)}
                  signedIn={!!session}
                  resolvedAtIso={playoffResolvedAtIso}
                />
              )}
            </>
          )}
          {/* Per-game schedule (#1007) — BELOW the bracket + lock-in button:
              the bracket is the focus, the schedule is reference underneath. */}
          <PlayoffScheduleStrip rounds={playoffScheduleRounds} />
          {/* Stop refreshing once the champion is decided — nothing changes.
              A SEALED bracket (not pickable) is a results-only view, so let the
              poller periodically reclaim the heap (#1268); while it's still
              pickable a hard reload could drop an unsaved bracket edit. */}
          {!playoffBracket?.championPickid && (
            <AutoRefresh intervalMs={60_000} reclaimSafe={!anyPlayoffPickable} />
          )}
        </div>
      ) : activePickability.pickable ? (
        <div className="sgp-stack rise d2">
          <PicksBoard
            section={section}
            teams={layout.teams}
            initialPicks={myPicks}
            enabled={!!session}
            eventId={EVENT_ID}
            steamLinked={!!session?.steamId}
            initiallySynced={mySectionSynced}
            liveTeamStats={liveTeamStats?.byPickid}
            liveStatsAsOf={liveTeamStats?.asOf}
            recordByTeam={liveStandings ? Object.fromEntries(recordsByPickId(liveStandings.rows)) : undefined}
            initialSeal={mySeal}
          />
          {/* #943: 24h before this stage locks, the live Swiss bracket AND the
              W-L standings table appear beneath the picker so you can study the
              opening matchups + field before you lock. Render once HLTV has
              published them; an honest placeholder stands in while they're live
              but not yet announced. */}
          {showLiveBracket &&
            (liveBracket || liveStandings ? (
              <>
                {liveBracket && (
                  <LiveSwissBracketBoard
                    rounds={liveBracket.rounds}
                    teamMap={buildTeamMap(layout)}
                    source={liveBracket.source}
                    sourceUrl={liveBracket.sourceUrl}
                    fetchedAtIso={liveBracket.fetchedAtIso}
                  />
                )}
                {liveStandings && (
                  <LiveSwissStandings
                    rows={liveStandings.rows}
                    teamMap={buildTeamMap(layout)}
                    source={liveStandings.source}
                    sourceUrl={liveStandings.sourceUrl}
                    fetchedAtIso={liveStandings.fetchedAtIso}
                  />
                )}
              </>
            ) : (
              <div className="sgp-note solo">
                <div>
                  <span className="eyebrow">Live bracket</span>
                  <p>The bracket and standings go live here <b>as soon as the opening matchups are announced</b>.</p>
                </div>
              </div>
            ))}
        </div>
      ) : swissStandings ? (
        <div className="sgp-stack rise d2">
          <LockedStageCard pickability={activePickability} compact complete={stageComplete} />
          {/* Stage Wrapped entry (#1054) — once the stage is OVER, the recap
              is the headline action here, right where the player lands. Opens the
              full personal deck on the stage reveal. */}
          {stageComplete && stageWrappedHasContent(activeSectionId) && (
            <Link href={`/reveal/${activeSectionId}`} className="sgp-wrapped" prefetch={false}>
              <span className="num" aria-hidden="true">
                {stageNumeral(activeLabel)}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="eyebrow">Stage Wrapped</span>
                <span className="t">Your {activeLabel} recap is in</span>
                <span className="s">Your score, the calls that landed, and the moments that decided it.</span>
              </span>
              <span className="arr" aria-hidden="true">
                →
              </span>
            </Link>
          )}
          {/* Your locked picks, in the SAME bucket-slot UI you picked them in
              (#902, replacing #898's YOUR BUILD / THE FIELD). Each call
              turns green/red as the answer key confirms it. Only when you picked. */}
          {Object.values(myPicks).some((g) => Object.values(g).some((p) => p > 0)) && (
            <LockedPicksBoard
              section={section}
              teamMap={buildTeamMap(layout)}
              myPicks={myPicks}
              teamStatus={new Map(swissStandings.teams.map((t) => [t.pickid, t.status]))}
              recordByTeam={liveStandings ? recordsByPickId(liveStandings.rows) : undefined}
              resolvedAtIso={outcomeResolvedAtIso}
            />
          )}
          {/* Live HLTV/BLAST-style Swiss BRACKET (the fan) for the whole field,
              under the build (#902), then the neutral W-L table below. Neither
              highlights the viewer's picks — that's the build's job. Both hidden
              until the first hourly crawl lands. */}
          {liveBracket && (
            <LiveSwissBracketBoard
              rounds={liveBracket.rounds}
              teamMap={buildTeamMap(layout)}
              source={liveBracket.source}
              sourceUrl={liveBracket.sourceUrl}
              fetchedAtIso={liveBracket.fetchedAtIso}
            />
          )}
          {liveStandings && (
            <LiveSwissStandings
              rows={liveStandings.rows}
              teamMap={buildTeamMap(layout)}
              source={liveStandings.source}
              sourceUrl={liveStandings.sourceUrl}
              fetchedAtIso={liveStandings.fetchedAtIso}
            />
          )}
          {/* Poll while the stage is live; stop once all slots are resolved.
              This is the locked, results-only lineup (no picker), so the poller
              can safely reclaim the heap on a long live session (#1268). */}
          {!stageComplete && <AutoRefresh intervalMs={60_000} reclaimSafe />}
        </div>
      ) : (
        <LockedStageCard pickability={activePickability} />
      )}

      {!session && (
        <div className="sgp-action" role="region" aria-label="Sign in">
          <div className="sgp-action-in">
            <div className="sgp-prog">
              <div className="c">
                <span className="s">Sign in to save your calls.</span>
              </div>
            </div>
            <Link href="/login" className="btn-solid" prefetch={false}>
              Sign in to Save
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The picks screen before Valve opens this Major's Pick'Em: no stages, no pool,
 * no sync. Countdown to Stage I (registry `stageOneStart`) + one honest line.
 */
function PicksNotOpen({
  event,
  signedIn,
}: {
  event: ReturnType<typeof getEventConfig>;
  signedIn: boolean;
}) {
  const name = event ? event.name.replace(/\s+CS2\s+Major\s+Championship$/i, "") : "This Major";
  const stageOne = event ? stageOneStartFor(event) : null;
  return (
    <div className="sgp-page">
      <StageHeader
        photo={PHOTOS.picksNotOpen}
        eyebrow={
          <>
            {name} · <b>Pick&apos;Em not open</b>
          </>
        }
        title="Pick'Em"
        lockbox={
          stageOne ? (
            <LockCountdown variant="box" lockAt={stageOne} boxLabel="Stage I starts" />
          ) : (
            <>
              <span className="k">Status</span>
              <span className="v sm">Not open</span>
            </>
          )
        }
      />
      <div className="sgp-note big rise d2">
        <span className="ic" aria-hidden="true">
          <LockIcon size={15} />
        </span>
        <div>
          <span className="eyebrow">Not open yet</span>
          <h2>Opens when Valve opens Pick&apos;Em</h2>
          <p>
            Valve hasn&apos;t opened Pick&apos;Em for <b>{name}</b> yet, so there are no stages or teams to call.
            When it opens, the field appears here and you can make your picks and sync them to Steam.
          </p>
          <p>Viewer Pass, Steam sync and picks are all available once Pick&apos;Em opens.</p>
          <span className="sgp-note-links">
            <Link href="/how-to-play" className="go" prefetch={false}>
              How it works →
            </Link>
            {!signedIn && (
              <Link href="/login" className="go" prefetch={false}>
                Sign in now →
              </Link>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function SteamLinkNotice() {
  return (
    <Link href="/help/auth-code" className="sgp-note solo" prefetch={false}>
      <div>
        <span className="tag warn">Saved here — not on Steam yet</span>
        <h2>Your picks are saved in HOTLINE</h2>
        <p>
          To push them to your <b>official in-game CS2 Pick&apos;Em</b>, connect your Steam Game
          Authentication Code. It takes a minute.
        </p>
        <span className="go">
          Connect Steam to sync
          <svg
            viewBox="0 0 24 24"
            width={12}
            height={12}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </div>
    </Link>
  );
}

function LockedStageCard({
  pickability,
  compact = false,
  complete = false,
}: {
  pickability: StagePickability;
  /** Tighter card used as a banner above the live lineup. */
  compact?: boolean;
  /** The stage is fully resolved (over), not merely locked/underway (#1054). */
  complete?: boolean;
}) {
  const heading =
    pickability.pickable
      ? "Locked"
      : complete
        ? "Stage complete"
        : pickability.reason === "teams-not-set"
          ? "Teams not set yet"
          : pickability.reason === "locked-time-passed"
            ? "Stage locked — it's underway"
            : pickability.reason === "locked-by-valve"
              ? "Locked by Valve"
              : "Locked";
  const subline =
    pickability.pickable
      ? undefined
      : complete
        ? "This stage is over. See how your picks landed below, then open the Stage Wrapped recap."
        : pickability.reason === "teams-not-set"
          ? "Teams for this stage aren't seeded yet. Picks open automatically once Valve sets the bracket."
          : pickability.reason === "locked-time-passed"
            ? "This stage has begun, so picks are locked. Track the teams you called in the live lineup below."
            : pickability.reason === "locked-by-valve"
              ? "Valve closed the pick window for this stage. Results appear here as matches complete."
              : "This stage isn't available.";

  // #1016: the lock state is a status strip, not a billboard — mono tag + one
  // line of plain copy, small stroke padlock. Same information, lower volume.
  const tag =
    !pickability.pickable && pickability.reason === "teams-not-set"
      ? "Awaiting seeding"
      : complete
        ? "Stage over"
        : "Picks locked";

  return (
    <div className={`sgp-note${compact ? "" : " big"}`}>
      <span className="ic" aria-hidden="true">
        <LockIcon size={15} />
      </span>
      <div>
        <span className="eyebrow">{tag}</span>
        <h2>{heading}</h2>
        {subline && <p>{subline}</p>}
      </div>
    </div>
  );
}
