import Link from "next/link";
import { getCommittedLayout, type Layout, type TeamDef } from "@/lib/layout";
import { getEffectiveLayout } from "@/lib/layout-state";
import { prisma } from "@/lib/db";
import { isStagePickable, selectCurrentStageIndex, PICKEM_NOT_OPEN } from "@/lib/stage-gate-core";
import { isPlayoffSection } from "@/lib/playoff-bracket-core";
import { getSession } from "@/lib/session";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { lockTimeForSection, isLockTimePassed } from "@/lib/lock-schedule-core";
import { getWireItems } from "@/lib/news";
import { safeHttpUrl, timeAgo, type WireItem } from "@/lib/news-core";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { WatchNow } from "@/components/watch/WatchNow";
import {
  currentEventId,
  getEventConfig,
  nextUpcomingEvent,
  previousMajor,
  stageOneStartFor,
  type EventConfig,
} from "@/lib/events-core";
import { majorChampion, majorWrappedStageKey, type MajorChampion } from "@/lib/stage-wrapped-launch";
import { statsForPickid, TEAM_STATS_AS_OF } from "@/lib/team-stats-core";
import { StageWrappedReplay } from "@/components/heat/StageWrappedReplay";
import { StageCountdown } from "@/components/sg/home/StageCountdown";
import { PHOTOS } from "@/lib/photos";

export const dynamic = "force-dynamic";

/** Event display name without the "CS2 … Major Championship" boilerplate. */
function shortEventName(name: string): string {
  return name.replace(/\s*CS2\s*/g, " ").replace(/\s*Major Championship\s*$/i, "").trim();
}

/** The host city, derived from the registry name ("PGL Major Singapore 2026" → "Singapore"). */
function eventCity(name: string): string {
  return name
    .replace(/\b(CS2|PGL|IEM|ESL|BLAST|Major|Championship|\d{4})\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Venue time zone per event, so "Opens 25 Nov" reads in local venue time. */
const VENUE_TZ: Record<string, string> = {
  "pgl-singapore-2026": "Asia/Singapore",
  "iem-cologne-2026": "Europe/Berlin",
};

function venueDay(iso: string, event: EventConfig | null): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: (event && VENUE_TZ[event.slug]) || "UTC",
  }).format(new Date(iso));
}

/**
 * Field-row photography (/public/wrapped). Presentation only: the row shows
 * whichever of these teams are in the committed layout, ordered by HLTV rank.
 */
const FIELD_PHOTOS: Record<string, { src: string; tint: string }> = {
  Falcons: { src: "/wrapped/player-139.webp", tint: "#0d3b2e" },
  Vitality: { src: "/wrapped/player-89.webp", tint: "#3a2a00" },
  "Team Spirit": { src: "/wrapped/player-81.webp", tint: "#1c1c1c" },
  "G2 Esports": { src: "/wrapped/player-59.webp", tint: "#2a2a2a" },
  FURIA: { src: "/wrapped/player-85.webp", tint: "#141414" },
  Aurora: { src: "/wrapped/player-134.webp", tint: "#0c2a3a" },
  BetBoom: { src: "/wrapped/player-137.webp", tint: "#3a1a00" },
  "9z Team": { src: "/wrapped/player-112.webp", tint: "#2a0a3a" },
};

const PHOTO_CREDIT = "IEM Cologne 2026 · HLTV";

export default async function DashboardPage() {
  // Resolve the active event PER REQUEST (#1046): this RSC is force-dynamic, so
  // when one Major archives and the next goes live the dashboard follows the clock
  // without a redeploy. (A module-level `ACTIVE_EVENT_ID` would pin the value for
  // the whole process lifetime and serve the stale event.)
  const EVENT_ID = currentEventId();
  const event = getEventConfig(EVENT_ID);
  // The event's own layout, or null until Valve opens its Pick'Em. Pre-open
  // there are no stages or teams to score, so an empty layout stands in and
  // every stage reads "not open" — never the previous Major's field.
  const effectiveLayout = await getEffectiveLayout(EVENT_ID);
  const preOpen = effectiveLayout === null;
  const layout: Layout = effectiveLayout ?? {
    event: EVENT_ID,
    name: event?.name ?? "",
    sections: [],
    teams: [],
  };
  const session = await getSession();

  // Live driver (#866): one atomic 30s claim gates a deferred background ingest
  // (via `after`), so "Live now" standings track each finished match with no cron
  // and no added render latency. Mirrors the news wire's refreshWireOnRead.
  await refreshOutcomesOnRead(EVENT_ID);

  const [resolvedRows, outcomeRows, allPicks, allPlayers, wireItemsAll, champion] = await Promise.all([
    prisma.stageOutcome.findMany({
      where: { eventId: EVENT_ID },
      select: { sectionId: true, groupId: true, slotIndex: true },
    }),
    prisma.stageOutcome.findMany({ where: { eventId: EVENT_ID } }),
    prisma.pick.findMany({
      where: { eventId: EVENT_ID },
      select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
    prisma.player.findMany({
      select: { id: true, displayName: true, avatarUrl: true },
    }),
    getWireItems(3),
    // The crowned champion, or null until the Grand Final resolves. Non-null
    // flips the whole dashboard into its "Major complete" send-off (#1274).
    majorChampion(EVENT_ID),
  ]);

  const wireItems = wireItemsAll;
  // Per-request server timestamp for relative "x ago" stamps and the countdown's
  // first render — this is a force-dynamic RSC that renders once per request,
  // so Date.now is intentional.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  // Maximum possible points across every group.
  const maxPoints = layout.sections.reduce(
    (acc, s) =>
      acc +
      s.groups.reduce(
        (gAcc, g) => gAcc + g.picks.length * g.points_per_pick,
        0,
      ),
    0,
  );

  // First stage whose pick window is still open; while nothing is open, the
  // stage currently in progress — never a future stage that hasn't opened yet
  // (#1007: the hero spotlit the un-seeded Grand Final a week early).
  const stageStatuses = layout.sections.map((s) => ({
    section: s,
    pick: isStagePickable(layout, s.sectionid, {
      lockedByTime: isLockTimePassed(s.sectionid, now, event?.lockSchedule),
    }),
  }));
  const activeIdx = selectCurrentStageIndex(stageStatuses.map((s) => s.pick));
  // Pre-open there are no sections: Stage I stands in, gated "pickem-not-open".
  const active = stageStatuses[activeIdx] ?? {
    section: { sectionid: 0, name: "Stage I", groups: [] },
    pick: PICKEM_NOT_OPEN,
  };

  // The three single-elim sections (108/109/110) read as ONE "Playoffs" stage on
  // the hero, the same way the picks page consolidates them (#1007).
  const activePlayoff = isPlayoffSection(active.section.sectionid);
  const activeLabel = activePlayoff ? "Playoffs" : active.section.name.split(" | ")[0];

  // How many of the active section's slots the signed-in player has already
  // locked (#883). Count distinct filled slots so a re-saved pick can't inflate
  // the tally past the slot count.
  const activeSlotCount = active.section.groups.reduce(
    (acc, g) => acc + g.picks.length,
    0,
  );
  const selfFilledSlots = session
    ? new Set(
        allPicks
          .filter(
            (p) =>
              p.playerId === session.playerId &&
              p.sectionId === active.section.sectionid,
          )
          .map((p) => `${p.groupId}:${p.slotIndex}`),
      ).size
    : 0;
  const selfPickComplete = activeSlotCount > 0 && selfFilledSlots >= activeSlotCount;

  // Leaderboard top 4 + self rank.
  const outcomeMap: OutcomeMap = {};
  for (const o of outcomeRows) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }
  const playerPickMap: PlayerPickMap = {};
  for (const p of allPicks) {
    playerPickMap[p.playerId] ??= {};
    playerPickMap[p.playerId][p.sectionId] ??= {};
    playerPickMap[p.playerId][p.sectionId][p.groupId] ??= {};
    playerPickMap[p.playerId][p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }
  const standings = allPlayers
    .map((p) => {
      const score = scorePlayer(layout, playerPickMap[p.id] ?? {}, outcomeMap);
      const isSelf = session?.playerId === p.id;
      return {
        playerId: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        score: score.total,
        bySection: score.bySection,
        isSelf,
      };
    })
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  const selfIdx = standings.findIndex((r) => r.isSelf);
  const selfRow = selfIdx >= 0 ? standings[selfIdx] : null;
  const selfBySection = selfRow?.bySection ?? [];
  const leader = standings[0];

  // Show top 4, but if "you" sit further down, swap them in at position 4 so
  // the panel always shows the player's own row.
  const top: typeof standings = standings.slice(0, 4);
  if (selfRow && !top.some((r) => r.isSelf)) {
    top[3] = selfRow;
  }

  const eventStarted = resolvedRows.length > 0;
  // Before anything scores, every player sits at 0 — ranks would be alphabetical
  // noise, so the standing card and board say so honestly.
  const boardLevel = !eventStarted && standings.every((r) => r.score === 0);
  // Once the Grand Final crowns a champion the Major is DONE — the eyebrow stops
  // saying "Live now" and the hero becomes a send-off (#1274).
  const eventLabel = champion ? "Major complete" : eventStarted ? "Live now" : "Pre-event";
  // Re-open the actual Major Wrapped deck (the app-wide launcher mounted in the
  // layout) via the replay bus — NOT a /reveal/<GF>?wrapped=1 link (#1274).
  const wrappedStageKey = majorWrappedStageKey(EVENT_ID);

  const eventName = shortEventName(event?.name ?? layout.name);
  const city = eventCity(event?.name ?? layout.name);
  // Singapore Stage I — from the registry, never hardcoded.
  const stageOneIso = event ? stageOneStartFor(event) : null;
  const preStage = !champion && !eventStarted && !!stageOneIso && Date.parse(stageOneIso) > now;
  const stageOneDay = stageOneIso ? venueDay(stageOneIso, event) : null;

  const prev = previousMajor(now);
  const prevLink = prev
    ? { href: `/leaderboard?major=${prev.slug}`, label: `Final standings · ${shortEventName(prev.name)}` }
    : null;

  // Pre-open the primary CTA explains the game instead of promising picks.
  const pickHref = preOpen ? "/how-to-play" : `/picks?section=${active.section.sectionid}`;
  const pickCta = preOpen
    ? "How It Works"
    : active.pick.pickable
    ? session
      ? selfPickComplete
        ? "Edit Picks"
        : selfFilledSlots > 0
          ? "Finish Picks"
          : "Make Picks"
      : "Make Picks"
    : active.pick.reason === "locked-time-passed" && session
      ? "Check Your Picks"
      : "View Stage";
  const lockAt = active.pick.pickable
    ? lockTimeForSection(active.section.sectionid, event?.lockSchedule)
    : null;

  // Stage path (prototype "One down, three to go"): each Swiss stage, plus the
  // playoff sections folded into one "Playoffs" cell.
  const resolvedBySection = new Map<number, number>();
  for (const r of resolvedRows) resolvedBySection.set(r.sectionId, (resolvedBySection.get(r.sectionId) ?? 0) + 1);
  type PathCell = {
    key: string;
    title: string;
    href: string;
    sectionIds: number[];
    state: "done" | "now" | "next";
    status: string;
  };
  const pathCells: PathCell[] = preOpen
    ? // No layout yet: the standard Major path (three Swiss stages + Playoffs), all not open.
      ["Stage I", "Stage II", "Stage III", "Playoffs"].map((title, i) => ({
        key: `pre-${i}`,
        title,
        href: "/picks",
        sectionIds: [],
        state: i === 0 ? ("now" as const) : ("next" as const),
        status: "not open",
      }))
    : [];
  stageStatuses.forEach((s, i) => {
    const playoff = isPlayoffSection(s.section.sectionid);
    const isActive = i === activeIdx;
    const scored = (resolvedBySection.get(s.section.sectionid) ?? 0) > 0;
    const status = s.pick.pickable
      ? "open"
      : s.pick.reason === "locked-time-passed" || s.pick.reason === "locked-by-valve"
        ? "locked"
        : "not seeded";
    if (playoff) {
      const existing = pathCells.find((c) => c.key === "playoffs");
      if (existing) {
        existing.sectionIds.push(s.section.sectionid);
        if (isActive) existing.state = "now";
        if (scored && existing.state === "next") existing.state = "done";
        return;
      }
      pathCells.push({
        key: "playoffs",
        title: "Playoffs",
        href: `/picks?section=${s.section.sectionid}`,
        sectionIds: [s.section.sectionid],
        state: isActive ? "now" : scored ? "done" : "next",
        status,
      });
      return;
    }
    pathCells.push({
      key: String(s.section.sectionid),
      title: s.section.name.split(" | ")[0],
      href: `/picks?section=${s.section.sectionid}`,
      sectionIds: [s.section.sectionid],
      state: isActive ? "now" : scored ? "done" : "next",
      status,
    });
  });
  const sectionMax = (id: number) =>
    layout.sections
      .find((s) => s.sectionid === id)
      ?.groups.reduce((a, g) => a + g.picks.length * g.points_per_pick, 0) ?? 0;
  const cellPoints = (ids: number[]) =>
    selfBySection.filter((b) => ids.includes(b.sectionId)).reduce((a, b) => a + b.points, 0);
  const cellMax = (ids: number[]) => ids.reduce((a, id) => a + sectionMax(id), 0);
  const cellScored = (ids: number[]) => ids.some((id) => (resolvedBySection.get(id) ?? 0) > 0);
  const scoredCount = pathCells.filter((c) => cellScored(c.sectionIds)).length;
  const NUM = ["Zero", "One", "Two", "Three", "Four", "Five", "Six"];
  const pathHeadline =
    champion || scoredCount === pathCells.length
      ? "Every stage called"
      : scoredCount === 0
        ? `${NUM[pathCells.length] ?? pathCells.length} stages, one run`
        : `${NUM[scoredCount] ?? scoredCount} down, ${(NUM[pathCells.length - scoredCount] ?? pathCells.length - scoredCount).toLowerCase()} to go`;

  // Field row: photographed teams present in the committed layout, by HLTV rank.
  // A contenders preview ("ranked by HLTV"), not the event's pick pool, so it
  // keeps reading the committed roster while the event has no layout.
  const fieldTeams = (preOpen ? getCommittedLayout() : layout).teams
    .filter((t) => FIELD_PHOTOS[t.name])
    .map((t) => ({ team: t, rank: statsForPickid(t.pickid)?.worldRank ?? null }))
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, 4);
  const statsAsOf = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${TEAM_STATS_AS_OF}T00:00:00Z`),
  );

  return (
    <div className="hm">
      {/* Hero — stage briefing (with the Stage I countdown pre-event), or the
          Major send-off once a champion is crowned. */}
      {champion ? (
        <ConcludedHero
          champion={champion}
          eventName={eventName}
          wrappedStageKey={wrappedStageKey}
          next={nextUpcomingEvent(now)}
          now={now}
        />
      ) : (
        <section className="bleed tall hm-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PHOTOS.homeHero} alt="" />
          <span className="credit">Photo · {PHOTO_CREDIT}</span>
          <div className="in">
            <div className="hm-hero-main">
              <span className="eyebrow rise hm-eyebrow">
                {eventStarted ? <span className="live">{eventLabel}</span> : <span>{eventName} · <b>{eventLabel}</b></span>}
                <span>
                  {activePlayoff ? "Playoffs" : `Stage ${String(Math.max(activeIdx, 0) + 1).padStart(2, "0")}`}
                </span>
                <StageStatusTag pickability={active.pick} />
              </span>
              <h1 className="display rise d1">
                {preStage ? (
                  <>
                    Stage I
                    <br />
                    opens in
                  </>
                ) : (
                  activeLabel
                )}
              </h1>
              {preStage && stageOneIso ? (
                <div className="rise d2">
                  <StageCountdown
                    target={stageOneIso}
                    serverNow={now}
                    label={
                      <>
                        Stage I · <b>Opens {stageOneDay}</b> · {city}
                      </>
                    }
                    live={{ href: "/picks", text: "Stage I is live" }}
                  />
                </div>
              ) : lockAt ? (
                <div className="rise d2">
                  <StageCountdown
                    target={lockAt}
                    serverNow={now}
                    size="md"
                    label={
                      <>
                        {activeLabel} · <b>until picks lock</b>
                      </>
                    }
                  />
                </div>
              ) : null}
              <StageBody
                pickability={active.pick}
                sectionName={activeLabel}
                signedIn={!!session}
                filledSlots={selfFilledSlots}
                totalSlots={activeSlotCount}
                isPlayoff={activePlayoff}
              />
            </div>
            <div className="cta rise d3">
              <Link href={pickHref} className="btn-solid" prefetch={false}>
                {pickCta}
              </Link>
              <Link href="/leaderboard" className="btn-ghost" prefetch={false}>
                View Ranks
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Stage path */}
      <section className="chap">
        <div className="chap-h">
          <h2>{pathHeadline}</h2>
          <p>
            {preOpen ? (
              <>
                Pick&apos;Em <b>isn&apos;t open yet</b>. Every stage opens when Valve opens Pick&apos;Em for {city}.
              </>
            ) : selfRow && !boardLevel ? (
              <>
                You have <b>{selfRow.score} of {maxPoints} points</b> banked.
              </>
            ) : (
              <>
                <b>{maxPoints} points</b> on the table across the Major
                {preStage && stageOneDay ? <>, from <b>{stageOneDay}</b></> : null}.
              </>
            )}
          </p>
        </div>
        <div className="hm-path" data-tip="home-path">
          {pathCells.map((c) => {
            const scored = cellScored(c.sectionIds);
            const state = scored && c.state !== "now" ? "done" : c.state;
            const isActiveCell = c.sectionIds.includes(active.section.sectionid);
            return (
              <Link key={c.key} href={c.href} prefetch={false} className={`hm-path-cell ${state}`}>
                <span className="d">
                  {c.title} · {scored ? "scored" : c.status}
                </span>
                <span className="t">{c.title}</span>
                {scored && session ? (
                  <span className="s">
                    {cellPoints(c.sectionIds)}
                    <small>/{cellMax(c.sectionIds)}</small>
                  </span>
                ) : isActiveCell && session && !activePlayoff ? (
                  <span className="s">
                    {selfFilledSlots}
                    <small>/{activeSlotCount} made</small>
                  </span>
                ) : (
                  <span className="s dim">—</span>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Your standing + the board */}
      <section className="hm-duo">
        {session ? (
          <div className="card hm-card">
            <span className="eyebrow">Your standing</span>
            <div className="hm-rank">
              <span className="bignum">
                {boardLevel || selfIdx < 0 ? "—" : String(selfIdx + 1).padStart(2, "0")}
              </span>
              {!boardLevel && selfIdx >= 0 && <span className="mono hm-ord">{ordSuffix(selfIdx + 1)}</span>}
            </div>
            <p className="hm-card-copy">
              {boardLevel ? (
                <>
                  Everyone starts level at <b>0</b>. Your rank moves the moment {preStage ? "Stage I" : activeLabel} scores.
                </>
              ) : selfRow && leader ? (
                selfIdx === 0 ? (
                  <b>Leading the board.</b>
                ) : (
                  <>
                    <b>{leader.score - selfRow.score}</b> from the leader.
                  </>
                )
              ) : (
                "No picks scored yet."
              )}
            </p>
            <div className="hm-meta">
              <span>
                Points <b>{selfRow?.score ?? 0}</b>
                {preOpen ? null : <> of {maxPoints}</>}
              </span>
              <span>
                {champion
                  ? "final"
                  : preOpen
                    ? "Pick'Em not open"
                    : `${activeLabel} ${
                      active.pick.pickable
                        ? "open"
                        : active.pick.reason === "locked-time-passed"
                          ? "live"
                          : "pending"
                    }`}
              </span>
            </div>
            <Link className="eyebrow" href={`/players/${encodeURIComponent(session.playerId)}`} prefetch={false}>
              Your profile →
            </Link>
          </div>
        ) : (
          <Link href="/login" className="card hm-card hm-getin" prefetch={false}>
            <span className="eyebrow">Get in</span>
            <h2 className="display">Connect Steam</h2>
            <p className="hm-card-copy">
              {preOpen
                ? "Sign in now. Picks and Steam sync open when Valve opens Pick'Em."
                : "Sync your Valve picks, save locally, and climb the board."}
            </p>
            <span className="eyebrow hm-go">Sign in →</span>
          </Link>
        )}

        <div className="card hm-card">
          <div className="sect-head hm-board-head">
            <span className="eyebrow">The board · Top 4</span>
            <Link href="/leaderboard" prefetch={false}>
              All ranks
            </Link>
          </div>
          {boardLevel && top.length > 0 && (
            <p className="hm-note">
              Live board for {eventName}. <b>Everyone is level at 0</b> until {preStage ? "Stage I" : activeLabel} scores.
            </p>
          )}
          {top.length === 0 ? (
            <p className="hm-note">No players yet. Be the first.</p>
          ) : (
            <div className="hm-mini">
              {top.map((row, idx) => {
                const rank = selfRow && row.isSelf && selfIdx >= 0 ? selfIdx + 1 : idx + 1;
                return <LeaderRow key={row.playerId} rank={rank} row={row} level={boardLevel} />;
              })}
            </div>
          )}
          {prevLink && (
            <Link href={prevLink.href} prefetch={false} className="hm-prev">
              <span>{prevLink.label}</span>
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      </section>

      {/* The field — photographic team row */}
      {fieldTeams.length > 0 && (
        <section className="chap">
          <div className="chap-h row2">
            <div>
              <h2>The contenders</h2>
              <p>
                Ranked by HLTV as of <b>{statsAsOf}</b>. {city}&apos;s field is set when Valve seeds Stage I.
              </p>
            </div>
            <Link className="eyebrow" href={preOpen ? "/teams" : "/picks"} prefetch={false}>
              {preOpen ? "Teams →" : "Open Pick'Em →"}
            </Link>
          </div>
          <div className="hm-field">
            {fieldTeams.map(({ team, rank }) => (
              <FieldCard key={team.pickid} team={team} rank={rank} />
            ))}
          </div>
        </section>
      )}

      {/* Latest — the wire */}
      <section className="chap">
        <div className="chap-h row2">
          <div>
            <h2>Latest</h2>
          </div>
          <Link className="eyebrow" href="/news" prefetch={false}>
            All news →
          </Link>
        </div>
        {wireItems.length > 0 ? (
          <div className="hm-wire">
            {wireItems.map((it) => (
              <WireLine key={it.externalId} item={it} now={now} />
            ))}
          </div>
        ) : (
          <p className="hm-note">
            The wire is quiet. Headlines drop on{" "}
            <Link href="/news" prefetch={false}>
              News
            </Link>
            .
          </p>
        )}
      </section>

      {/* News + Info are reached from Home on mobile (bottom nav carries five tabs). */}
      <section className="chap hm-more">
        <div className="chap-h">
          <h2>Everything else</h2>
        </div>
        <nav className="hair-list hm-more-list" aria-label="More">
          <Link href="/news" prefetch={false}>
            <span>News</span>
            <span className="muted">Headlines from the scene</span>
          </Link>
          <Link href="/info" prefetch={false}>
            <span>Info</span>
            <span className="muted">Rules, scoring and the app</span>
          </Link>
          <Link href="/how-to-play" prefetch={false}>
            <span>How to play</span>
            <span className="muted">Four stages in two minutes</span>
          </Link>
          <Link href="/faq" prefetch={false}>
            <span>FAQ</span>
            <span className="muted">Answers, fast</span>
          </Link>
        </nav>
      </section>

      {/* Watch the official streams — the channel list is ESL's (IEM Cologne),
          so it only renders while that's the event being served. Re-point
          WatchNow at the broadcaster's channels before showing it for others. */}
      {event?.slug === "iem-cologne-2026" && <WatchNow />}
    </div>
  );
}

/**
 * The dashboard hero AFTER the Major is decided (#1274) — names the champion
 * and points everyone at the Wrapped recap and the final board, plus a real
 * countdown to the next Major's Stage I (#1328).
 */
function ConcludedHero({
  champion,
  eventName,
  wrappedStageKey,
  next,
  now,
}: {
  champion: MajorChampion;
  eventName: string;
  wrappedStageKey: string;
  /** The next Major on the registry's clock (#1328), or null if none is staged. */
  next: ReturnType<typeof nextUpcomingEvent>;
  /** Caller's per-request timestamp (keeps this render pure). */
  now: number;
}) {
  const nextStart = next ? stageOneStartFor(next) : null;
  return (
    <section className="bleed tall hm-hero">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={PHOTOS.homeChampion} alt="" />
      <span className="credit">Photo · {PHOTO_CREDIT}</span>
      <div className="in">
        <div className="hm-hero-main">
          <span className="eyebrow rise hm-eyebrow">
            <span>
              {eventName} · <b>Champions</b>
            </span>
            <span className="tag">That&apos;s a wrap</span>
          </span>
          <div className="hm-champ rise d1">
            {champion.logoSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={champion.logoSrc} alt="" width={72} height={72} />
            )}
            <h1 className="display">{champion.name}</h1>
          </div>
          <p className="rise d2">
            <b>{champion.name}</b> are your {eventName} champions. Thanks for calling it with us all Major long — the
            recap has the whole run.
          </p>
          {next && nextStart && (
            <div className="rise d2">
              <StageCountdown
                target={nextStart}
                serverNow={now}
                size="md"
                label={
                  <>
                    Next · <b>{shortEventName(next.name)}</b> · Stage I
                  </>
                }
                live={{ href: "/picks", text: "Stage I is live" }}
              />
            </div>
          )}
        </div>
        <div className="cta rise d3">
          <StageWrappedReplay stageKey={wrappedStageKey} label="Watch the Wrapped recap" className="btn-solid" />
          <Link href="/leaderboard" className="btn-ghost" prefetch={false}>
            Final Ranks
          </Link>
          {next && (
            <Link href="/majors" className="btn-ghost" prefetch={false}>
              {eventCity(eventName)} story + your coins
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function StageStatusTag({ pickability }: { pickability: ReturnType<typeof isStagePickable> }) {
  if (pickability.pickable) return <span className="tag warn">Picks Open</span>;
  if (pickability.reason === "pickem-not-open") return <span className="tag">Picks not open</span>;
  if (pickability.reason === "locked-time-passed") return <span className="tag">Underway · Locked</span>;
  if (pickability.reason === "locked-by-valve") return <span className="tag">Locked by Valve</span>;
  if (pickability.reason === "teams-not-set") return <span className="tag">Teams not set</span>;
  return null;
}

function StageBody({
  pickability,
  sectionName,
  signedIn,
  filledSlots,
  totalSlots,
  isPlayoff = false,
}: {
  pickability: ReturnType<typeof isStagePickable>;
  sectionName: string;
  signedIn: boolean;
  filledSlots: number;
  totalSlots: number;
  /** The active stage is the single-elim playoff bracket — use bracket copy,
   *  not the Swiss 3-0 / 0-3 / advancing-eight language (#1007). */
  isPlayoff?: boolean;
}) {
  const complete = totalSlots > 0 && filledSlots >= totalSlots;
  // Playoffs are one single-elim bracket (QF→SF→GF), not a Swiss board — so the
  // open/seeding copy speaks "bracket calls", never "who goes 3-0".
  const text = pickability.pickable
    ? isPlayoff
      ? signedIn
        ? `The playoff bracket is open. Call it from the quarterfinals to the Grand Final — pick your champion before the quarters begin.`
        : `The playoff bracket is open. Sign in to call the quarterfinals through the Grand Final before it locks.`
      : signedIn
        ? complete
          ? `Your ${sectionName} picks are locked in — all ${totalSlots} slots set. Tweak them anytime before the window shuts.`
          : filledSlots > 0
            ? `${filledSlots} of ${totalSlots} ${sectionName} slots locked. Finish the rest — who goes 3‑0, who crashes 0‑3, your advancing eight — before the window shuts.`
            : `You haven't called your ${sectionName} picks yet. Lock who goes 3‑0, who crashes 0‑3, and your advancing eight before the window shuts.`
        : `Pick window is open. Sign in to lock your ${sectionName} picks before the window shuts.`
    : pickability.reason === "pickem-not-open"
      ? `Valve hasn't opened Pick'Em for this Major yet. Picks, Steam sync and the Viewer Pass open when it does.`
      : pickability.reason === "teams-not-set"
      ? isPlayoff
        ? `The eight are still being seeded. The playoff bracket opens automatically once Valve sets the matchups.`
        : `Teams for ${sectionName} aren't seeded yet. Picks open automatically once Valve sets the bracket.`
      : pickability.reason === "locked-time-passed"
        ? signedIn
          ? `${sectionName} is underway — picks are locked. Check how your picks are tracking on the live bracket, keep an eye on the leaderboard, and catch the matches below.`
          : `${sectionName} is underway — picks are locked. Follow the live bracket, the leaderboard, and the matches below.`
        : pickability.reason === "locked-by-valve"
          ? `Valve has closed the pick window for ${sectionName}. Watch the wire for results.`
          : "This stage isn't available.";

  return <p className="rise d2">{text}</p>;
}

function LeaderRow({
  rank,
  row,
  level,
}: {
  rank: number;
  row: { playerId: string; displayName: string; avatarUrl: string | null; score: number; isSelf: boolean };
  /** Everyone is tied at 0 — show "—" instead of an alphabetical rank. */
  level: boolean;
}) {
  return (
    <Link
      href={`/players/${encodeURIComponent(row.playerId)}`}
      prefetch={false}
      className={row.isSelf ? "me" : undefined}
    >
      <span className="r">{level ? "—" : String(rank).padStart(2, "0")}</span>
      <span className="n">
        <span
          className="av"
          style={row.avatarUrl ? { backgroundImage: `url(${JSON.stringify(row.avatarUrl)})` } : undefined}
          aria-hidden="true"
        />
        <span className="nm">{row.displayName}</span>
        {row.isSelf && <span className="you">You</span>}
      </span>
      <span className="p">{row.score}</span>
    </Link>
  );
}

function FieldCard({ team, rank }: { team: TeamDef; rank: number | null }) {
  const photo = FIELD_PHOTOS[team.name];
  return (
    <Link
      href="/picks"
      prefetch={false}
      className="hm-field-card"
      style={{ ["--c" as string]: photo.tint }}
      aria-label={`${team.name}${rank ? `, HLTV world #${rank}` : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.src} alt="" loading="lazy" />
      <span className="nm">{team.name.replace(/^Team /, "").replace(/ (Esports|Team)$/, "")}</span>
      <span className="pc">{rank ? `HLTV world #${rank}` : "Unranked"}</span>
    </Link>
  );
}

function WireLine({ item, now }: { item: WireItem; now: number }) {
  const href = safeHttpUrl(item.sourceUrl);
  const inner = (
    <>
      <span className="src">
        {item.source} · {timeAgo(item.publishedAt, now)}
      </span>
      <span className="h">{item.headline}</span>
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    <Link href="/news" prefetch={false}>
      {inner}
    </Link>
  );
}

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
