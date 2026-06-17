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
import { currentEventId } from "@/lib/events-core";

export const dynamic = "force-dynamic";

export default async function PicksPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  // Per-request active event (PHA-1046) — force-dynamic, follows the clock across Majors.
  const EVENT_ID = currentEventId();
  const params = await searchParams;
  await refreshLayoutOnRead(EVENT_ID); // live driver — throttled, deferred past render
  const layout = await getEffectiveLayout(EVENT_ID);
  const session = await getSession();

  if (session?.steamId) {
    await mirrorPlayerPredictionsThrottled(session.playerId, EVENT_ID);
  }

  // Live driver (PHA-866/898): keep the answer key fresh so a locked stage's
  // lineup tracks results as teams clinch. Atomic 30s claim, deferred ingest.
  await refreshOutcomesOnRead(EVENT_ID);

  // Per-request server clock — this is a force-dynamic RSC rendered once per
  // request, so reading the time to evaluate the published lock schedule is
  // intentional (mirrors the dashboard).
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  // Live team-dossier refresh (PHA-921): keep each team's "Last 5 matches" fresh
  // per stage. Atomic ~1h claim, deferred batch crawl, gated to match windows —
  // off-days no-op. The merged read below feeds the [i] dossier; off-window /
  // cold start falls back to the committed frozen snapshot (never empty).
  await refreshTeamStatsOnRead(EVENT_ID, nowMs);

  // Live playoff Spotlight odds refresh (PHA-1066): same on-read, ~1h-claimed,
  // deferred pattern as the dossier, but the source is Polymarket's gamma-api.
  // Gated to an authored matchup registry (empty until Valve seeds the bracket),
  // so this is a no-op until a real playoff matchup exists to target.
  await refreshSpotlightOddsOnRead(EVENT_ID, nowMs);

  // Signed in via Steam but no auth code yet: picks save in HOTLINE, but we
  // can't push them to the official in-game CS2 Pick'Em until they connect a
  // Game Authentication Code. Surface that gap up front with a link (PHA-891).
  const needsSteamLink = session?.steamId
    ? !(await hasAuthCode(session.playerId))
    : false;

  // Scheduled hard lock (PHA-886/898): once a stage's first match starts, its
  // pick window is closed — even though the committed layout still says
  // picks_allowed and an outcome row hasn't landed yet. The published schedule
  // is the truthful signal; the gate surfaces `locked-time-passed` (friendlier
  // copy that introduces the live lineup below) and POST /api/picks mirrors the
  // same lock. Playoffs have no published time (null) → unaffected. Computed
  // once in layout order, then keyed by id for the tab/lock rendering below.
  const orderedPickability = layout.sections.map((s) =>
    isStagePickable(layout, s.sectionid, {
      lockedByTime: isLockTimePassed(s.sectionid, nowMs),
    }),
  );
  const sectionPickability: Map<number, StagePickability> = new Map(
    layout.sections.map((s, i) => [s.sectionid, orderedPickability[i]]),
  );

  // PHA-1050: clicking "Picks" with no ?section lands on the event's CURRENT
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

  // PHA-1016: the playoffs are ONE pick'em stage — quarters, semis and the
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

  // Per-game playoff schedule (PHA-1007): each round's games with their committed
  // date/time, fed to the schedule strip. Dark until COLOGNE_PLAYOFF_SCHEDULE is
  // filled (the strip renders nothing while every iso is null).
  const playoffScheduleRounds = PLAYOFF_ROUNDS.map((def) => {
    const sec = playoffSections.find((s) => s.sectionid === def.sectionId);
    const games = (sec?.groups ?? []).map((_g, i) => ({
      label: def.key === "GF" ? "Grand Final" : `Match ${i + 1}`,
      iso: playoffGameTime(def.sectionId, i),
    }));
    return { short: def.short, label: def.label, games };
  });

  const myPicks: Record<number, Record<number, number>> = {};
  if (session) {
    const picks = await prisma.pick.findMany({
      where: { playerId: session.playerId, eventId: EVENT_ID, sectionId: activeSectionId },
    });
    for (const pick of picks) {
      myPicks[pick.groupId] ??= {};
      myPicks[pick.groupId][pick.slotIndex] = pick.pickId;
    }
  }

  // Live Swiss lineup (PHA-898): once a Swiss stage locks we show the standings
  // in place of the picker. Build it from the resolved answer key + the viewer's
  // picks. Only fetch when we'd actually render it (locked Swiss section).
  const isSwiss = isSwissSection(activeSectionId);
  const showLineup = !!section && !activePickability.pickable && isSwiss;
  // PHA-943: the live Swiss bracket goes live 24h before the stage's lock (= its
  // first match) — so the opening matchups are visible the day before, while
  // picks are STILL open — and stays up after lock. Before that reveal instant we
  // don't render it (and the crawl is gated off). Playoff sections have no lock
  // time → isBracketRevealed is false; they render via the playoff branch below.
  const bracketRevealed = isBracketRevealed(activeSectionId, nowMs);
  const showLiveBracket = !!section && isSwiss && (showLineup || bracketRevealed);
  const matchTeams = layout.teams.map((t) => ({ pickid: t.pickid, name: t.name }));

  let swissStandings: ReturnType<typeof buildSwissStandings> | null = null;
  let outcomeResolvedAtIso: string | null = null;
  // Whether this Swiss stage is OVER (every slot resolved), not merely locked /
  // underway — drives the "stage complete" copy + the Stage Wrapped entry below.
  let stageComplete = false;
  // Live HLTV/BLAST-style W-L standings (PHA-902): the running win-loss table the
  // Valve answer key can't provide. Hourly on-read refresh, graceful-empty.
  let liveStandings: Awaited<ReturnType<typeof getSwissStandings>> = null;
  let liveBracket: Awaited<ReturnType<typeof getSwissBracket>> = null;

  // The bracket (the fan of matchups) AND the W-L standings table both go live
  // from the reveal instant on — pre- and post-lock (Brandon, PHA-943: "and the
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

  // Live playoffs bracket (PHA-903): the single-elim QF → SF → GF tree. Unlike
  // the Swiss bracket (an HLTV crawl), the playoff TREE is fully described by our
  // layout — it just fills in live as Stage 3 resolves: seeded teams arrive on
  // the layout team slots, winners arrive as StageOutcome rows. We always render
  // the WHOLE tree (all three playoff sections) regardless of which playoff tab
  // is open, matching Brandon's reference. Built only when viewing a playoff tab.
  let playoffBracket: ReturnType<typeof buildPlayoffBracket> | null = null;
  let playoffResolvedAtIso: string | null = null;
  // PHA-1204: the predictor model (QF→SF→GF feed tree) + the viewer's saved
  // winner per match, keyed by groupId (slot 0). Feeds the single interactive
  // bracket that replaces the stacked round-pickers.
  let playoffPickModel: ReturnType<typeof buildPlayoffPickTree> | null = null;
  const playoffInitialPicks: Record<number, number> = {};
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
    playoffBracket = buildPlayoffBracket({ sections: playoffSections, userPickByGroup, winnerByGroup });
  }

  // Live dossier map for the picker's [i] affordance (PHA-921). Only read when
  // the picker is actually shown; the merged map overrides each team's recent[]
  // with live results while keeping roster/rank frozen, and is null off-window /
  // cold (the drawer then uses the committed snapshot).
  const liveTeamStats =
    activePickability.pickable || (playoffActive && anyPlayoffPickable)
      ? await getLiveTeamStats(EVENT_ID)
      : null;

  // Live market lines for the playoff Spotlight (PHA-1066). Playoff-only — the
  // Spotlight modal is the only place that renders a market bar. Empty {} until a
  // matchup is authored, in which case the modal shows its "coming soon" state.
  const spotlightMarket = playoffActive ? await getSpotlightMarket(EVENT_ID, nowMs) : undefined;

  // Header: the consolidated Playoffs tab reads as one stage regardless of
  // which playoff section id is in the URL; Swiss stages keep their number.
  const firstPlayoffIdx = layout.sections.findIndex((s) => isPlayoffSection(s.sectionid));
  const activeIdx = playoffActive
    ? firstPlayoffIdx
    : layout.sections.findIndex((s) => s.sectionid === activeSectionId);
  const activeLabel = playoffActive
    ? "Playoffs"
    : section?.name.split(" | ")[0] ?? "Picks";
  const activeNumber = activeIdx >= 0 ? activeIdx + 1 : 1;

  return (
    <>
      {/* Stage header. Playoffs wear the v3 "Cathedral" treatment (PHA-1065):
          Cologne is the Cathedral of Counter-Strike, so the climax stage gets a
          centered hero crowned by a thin pointed-arch vault. Swiss stages keep
          the standard left-aligned eyebrow + wordmark. */}
      {playoffActive ? (
        <div className="cath-hero">
          <svg className="cath-arch" viewBox="0 0 188 60" fill="none" aria-hidden="true">
            <path d="M2 60 L2 30 Q2 2 94 2 Q186 2 186 30 L186 60" stroke="rgba(240,175,80,0.30)" strokeWidth="1" />
            <path d="M22 60 L22 34 Q22 14 94 14 Q166 14 166 34 L166 60" stroke="rgba(240,175,80,0.16)" strokeWidth="1" />
            <line x1="94" y1="6" x2="94" y2="60" stroke="rgba(240,175,80,0.14)" strokeWidth="1" />
          </svg>
          <span className="cath-eyebrow">Cathedral of Counter&#8209;Strike</span>
          <h1 className="cath-title">{activeLabel}</h1>
          <div className="cath-sub">Single Elimination &middot; Eight Remain</div>
          {anyPlayoffPickable && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 13 }}>
              <LockCountdown lockAt={lockTimeForSection(playoffSectionIds[0])} />
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="eyebrow-mono">STAGE {String(activeNumber).padStart(2, "0")}</span>
          <h1 className="font-display" style={{
            fontWeight: 800,
            fontSize: "clamp(28px, 5vw, 40px)",
            textTransform: "uppercase",
            lineHeight: 0.95,
          }}>
            {activeLabel}
          </h1>
          {activePickability.pickable && (
            <LockCountdown lockAt={lockTimeForSection(activeSectionId)} />
          )}
        </div>
      )}

      {/* Steam-connected but no auth code: picks live in HOTLINE, not yet
          pushed to the official in-game Pick'Em. Point them at the page. */}
      {needsSteamLink && <SteamLinkNotice />}

      {/* Stage tabs */}
      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          paddingBottom: 4,
          marginBottom: 4,
        }}
      >
        {(() => {
          // Tab model (PHA-1016): one chip per Swiss stage, then a single
          // PLAYOFFS chip — quarters/semis/finals open and lock together as
          // one pick'em stage, so they tab as one.
          const lockTitleFor = (pick: StagePickability) =>
            pick.pickable
              ? undefined
              : pick.reason === "teams-not-set"
                ? "Locked — teams not set yet"
                : pick.reason === "locked-by-valve"
                  ? "Locked by Valve"
                  : "Locked";

          const tabs = layout.sections
            .filter((s) => !isPlayoffSection(s.sectionid))
            .map((s) => {
              const pick = sectionPickability.get(s.sectionid)!;
              return {
                key: String(s.sectionid),
                href: `/picks?section=${s.sectionid}`,
                label: s.name.split(" | ")[0],
                active: !playoffActive && s.sectionid === activeSectionId,
                locked: !pick.pickable,
                lockTitle: lockTitleFor(pick),
              };
            });
          if (playoffSections.length > 0) {
            const repPick =
              sectionPickability.get(playoffSections[0].sectionid) ??
              ({ pickable: false, reason: "unknown-section" } as StagePickability);
            tabs.push({
              key: "playoffs",
              href: `/picks?section=${playoffSections[0].sectionid}`,
              label: "Playoffs",
              active: playoffActive,
              locked: !anyPlayoffPickable,
              lockTitle: anyPlayoffPickable ? undefined : lockTitleFor(repPick),
            });
          }
          return tabs.map((t) => {
            const { active, locked } = t;

            const baseStyle: React.CSSProperties = {
            flexShrink: 0,
            padding: "10px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            textDecoration: "none",
            minHeight: 40,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            transition: "border-color 160ms var(--ease), color 160ms var(--ease), background 160ms var(--ease)",
            background: active
              ? "rgba(240,163,0,0.08)"
              : "var(--surf-1)",
            color: active
              ? "var(--heat)"
              : locked
                ? "var(--ink-low)"
                : "var(--ink-mid)",
            border: active
              ? "1px solid var(--hair-3)"
              : locked
                ? "1px dashed var(--hair)"
                : "1px solid var(--hair)",
            cursor: "pointer",
            boxShadow: active ? "0 0 0 0px var(--heat)" : "none",
          };

            // Every tab is navigable — a locked stage is "can't pick", not
            // "can't look": clicking it shows that stage's content (its live
            // lineup / your build, or a "teams not set" card). Previously a
            // locked, non-active tab rendered as a disabled span, so once you
            // left Stage I you couldn't click back to view it (Brandon,
            // 2026-06-03). The small padlock still flags that picks are closed.
            return (
              <Link
                key={t.key}
                href={t.href}
                title={t.lockTitle}
                aria-current={active ? "page" : undefined}
                style={baseStyle}
              >
                {locked && (
                  <span aria-hidden="true" style={{ opacity: 0.65, display: "inline-flex" }}>
                    <LockIcon size={10} />
                  </span>
                )}
                {t.label}
              </Link>
            );
          });
        })()}
      </div>

      {/* Stage content */}
      {!section ? (
        <p style={{ color: "var(--ink-mid)" }}>Section not found.</p>
      ) : playoffActive ? (
        // Consolidated Playoffs view (PHA-1016): one stage, one tab. When
        // Valve seeds + opens the bracket the three round pickers stack here
        // (they all lock together); until then an honest status strip. The
        // full QF → SF → GF tree renders beneath either way.
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {anyPlayoffPickable && playoffPickModel ? (
            // PHA-1204: ONE bracket, placed at once. The interactive QF→SF→GF
            // tree replaces the three stacked round-pickers — crown a winner and
            // they advance into the round they feed.
            <PlayoffBracketPicker
              model={playoffPickModel}
              teams={layout.teams}
              initialPicks={playoffInitialPicks}
              enabled={!!session}
              eventId={EVENT_ID}
              signedIn={!!session}
              steamLinked={!!session?.steamId}
              liveTeamStats={liveTeamStats?.byPickid}
              liveStatsAsOf={liveTeamStats?.asOf}
              spotlightMarket={spotlightMarket}
            />
          ) : (
            <>
              {/* PHA-1043: before Valve seeds, the picker is empty, so a
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
          {/* Per-game schedule (PHA-1007) — BELOW the bracket + lock-in button:
              the bracket is the focus, the schedule is reference underneath. */}
          <PlayoffScheduleStrip rounds={playoffScheduleRounds} />
          <AutoRefresh intervalMs={60_000} />
        </div>
      ) : activePickability.pickable ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <PicksBoard
            section={section}
            teams={layout.teams}
            initialPicks={myPicks}
            enabled={!!session}
            eventId={EVENT_ID}
            steamLinked={!!session?.steamId}
            liveTeamStats={liveTeamStats?.byPickid}
            liveStatsAsOf={liveTeamStats?.asOf}
          />
          {/* PHA-943: 24h before this stage locks, the live Swiss bracket AND the
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
              <div className="panel" style={{ padding: "20px 18px" }}>
                <span className="eyebrow-mono" style={{ color: "var(--heat)" }}>LIVE BRACKET</span>
                <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "10px 0 0", lineHeight: 1.5 }}>
                  The bracket and standings go live here as soon as the opening matchups are announced.
                </p>
              </div>
            ))}
        </div>
      ) : swissStandings ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <LockedStageCard pickability={activePickability} compact complete={stageComplete} />
          {/* Stage Wrapped entry (PHA-1054) — once the stage is OVER, the recap
              is the headline action here, right where the player lands. Opens the
              full personal deck on the stage reveal. */}
          {stageComplete && stageWrappedHasContent(activeSectionId) && (
            <Link
              href={`/reveal/${activeSectionId}`}
              className="panel brk"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                textDecoration: "none",
                padding: "16px 20px",
                borderColor: "var(--heat)",
                background: "rgba(240,163,0,0.05)",
              }}
            >
              <span className="br-tr" />
              <span className="br-bl" />
              <span
                className="font-display foil"
                aria-hidden="true"
                style={{ fontWeight: 800, fontSize: 40, lineHeight: 0.8, letterSpacing: "0.03em", filter: "drop-shadow(0 0 12px var(--heat-glow))" }}
              >
                {stageNumeral(activeLabel)}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="eyebrow-mono" style={{ color: "var(--heat)", display: "block" }}>
                  STAGE WRAPPED
                </span>
                <span
                  className="font-display"
                  style={{ display: "block", fontWeight: 800, fontSize: 17, textTransform: "uppercase", color: "var(--ink-hi)", margin: "5px 0 0", lineHeight: 1.15 }}
                >
                  Your {activeLabel} recap is in
                </span>
                <span style={{ display: "block", color: "var(--ink-mid)", fontSize: 13, margin: "4px 0 0" }}>
                  The craziest moments, your score, and where you landed — tap through the recap.
                </span>
              </span>
              <span className="font-display" aria-hidden="true" style={{ color: "var(--heat)", fontSize: 22, fontWeight: 800 }}>
                →
              </span>
            </Link>
          )}
          {/* Your locked picks, in the SAME bucket-slot UI you picked them in
              (PHA-902, replacing PHA-898's YOUR BUILD / THE FIELD). Each call
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
              under the build (PHA-902), then the neutral W-L table below. Neither
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
          {/* Poll the answer key + standings while the stage is live so the
              lineup updates without a manual reload (PHA-898 / PHA-902). */}
          <AutoRefresh intervalMs={60_000} />
        </div>
      ) : (
        <LockedStageCard pickability={activePickability} />
      )}

      {!session && (
        <Link
          href="/login/auth"
          className="btn-heat"
          style={{
            position: "fixed",
            bottom: "calc(76px + env(safe-area-inset-bottom))",
            right: 20,
            zIndex: 49,
          }}
        >
          Sign in to Save
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      )}
    </>
  );
}

function SteamLinkNotice() {
  return (
    <Link
      href="/help/auth-code"
      className="panel brk"
      style={{
        display: "block",
        textDecoration: "none",
        borderColor: "var(--hair-3)",
        background: "rgba(240,163,0,0.06)",
      }}
    >
      <span className="br-tr" />
      <span className="br-bl" />
      <span
        className="eyebrow-mono"
        style={{ color: "var(--heat)", display: "block" }}
      >
        SAVED HERE — NOT ON STEAM YET
      </span>
      <p
        className="font-display"
        style={{
          fontWeight: 800,
          fontSize: 17,
          textTransform: "uppercase",
          letterSpacing: "0.01em",
          color: "var(--ink-hi)",
          margin: "8px 0 0",
          lineHeight: 1.1,
        }}
      >
        Your picks are locked into HOTLINE
      </p>
      <p
        style={{
          color: "var(--ink-mid)",
          fontSize: 13,
          lineHeight: 1.55,
          margin: "6px 0 0",
        }}
      >
        To push them to your <em style={{ marginRight: "0.15em" }}>official</em>{" "}
        in-game CS2 Pick&apos;Em, connect your Steam Game Authentication Code.
        Takes a minute.
      </p>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          marginTop: 12,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--heat)",
        }}
      >
        Connect Steam to sync
        <svg
          viewBox="0 0 24 24"
          width={14}
          height={14}
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
  /** The stage is fully resolved (over), not merely locked/underway (PHA-1054). */
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
        ? "This stage is over. See how your picks landed in the final lineup below — and tap the Stage Wrapped recap for the story."
        : pickability.reason === "teams-not-set"
          ? "Teams for this stage aren't seeded yet. Picks open automatically once Valve sets the bracket."
          : pickability.reason === "locked-time-passed"
            ? "This stage has begun, so picks are locked. Track how the teams you called are doing in the live lineup below."
            : pickability.reason === "locked-by-valve"
              ? "Valve closed the pick window for this stage. Results will appear here as matches complete."
              : "This stage isn't available.";

  // PHA-1016: the lock state is a status strip, not a billboard — left-aligned
  // mono tag + one line of plain copy, small stroke padlock instead of the
  // emoji shout. Same information, lower volume.
  const tag =
    !pickability.pickable && pickability.reason === "teams-not-set"
      ? "AWAITING SEEDING"
      : complete
        ? "STAGE OVER"
        : "PICKS LOCKED";

  return (
    <div
      className="panel"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: compact ? "16px 18px" : "22px 20px",
        borderLeft: "2px solid var(--heat)",
      }}
    >
      <span aria-hidden="true" style={{ color: "var(--heat)", marginTop: 1, display: "inline-flex" }}>
        <LockIcon size={15} />
      </span>
      <div style={{ minWidth: 0 }}>
        <span className="eyebrow-mono" style={{ color: "var(--heat)", display: "block" }}>
          {tag}
        </span>
        <p
          className="font-display"
          style={{
            fontWeight: 800,
            fontSize: compact ? 15 : 17,
            textTransform: "uppercase",
            letterSpacing: "0.01em",
            color: "var(--ink-hi)",
            margin: "7px 0 0",
            lineHeight: 1.15,
          }}
        >
          {heading}
        </p>
        {subline && (
          <p
            style={{
              color: "var(--ink-mid)",
              fontSize: 13,
              margin: "5px 0 0",
              maxWidth: 520,
              lineHeight: 1.5,
            }}
          >
            {subline}
          </p>
        )}
      </div>
    </div>
  );
}
