import Link from "next/link";
import { getCommittedLayout } from "@/lib/layout";
import { prisma } from "@/lib/db";
import { isStagePickable, selectCurrentStageIndex } from "@/lib/stage-gate-core";
import { getSession } from "@/lib/session";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { HeatMark } from "@/components/heat/HeatMark";
import { LockCountdown } from "@/components/heat/LockCountdown";
import { lockTimeForSection, isLockTimePassed } from "@/lib/lock-schedule-core";
import { WireFeed } from "@/components/heat/WireFeed";
import { getWireItems } from "@/lib/news";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { WatchNow } from "@/components/watch/WatchNow";
import { ACTIVE_EVENT_ID } from "@/lib/events-core";

const EVENT_ID = ACTIVE_EVENT_ID;
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const layout = getCommittedLayout();
  const session = await getSession();

  // Live driver (PHA-866): one atomic 30s claim gates a deferred background ingest
  // (via `after`), so "Live now" standings track each finished match with no cron
  // and no added render latency. Mirrors the news wire's refreshWireOnRead.
  await refreshOutcomesOnRead(EVENT_ID);

  const [resolvedRows, outcomeRows, allPicks, allPlayers, wireItemsAll] = await Promise.all([
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
  ]);

  const wireItems = wireItemsAll;
  // Per-request server timestamp for relative "x ago" stamps — this is a
  // force-dynamic RSC that renders once per request, so Date.now is intentional.
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
  // (PHA-1007: the hero spotlit the un-seeded Grand Final a week early).
  const stageStatuses = layout.sections.map((s) => ({
    section: s,
    pick: isStagePickable(layout, s.sectionid, {
      lockedByTime: isLockTimePassed(s.sectionid, now),
    }),
  }));
  const activeIdx = selectCurrentStageIndex(stageStatuses.map((s) => s.pick));
  const active = stageStatuses[activeIdx];

  const activeLabel = active.section.name.split(" | ")[0];
  const activeNumber = activeIdx + 1;

  // How many of the active section's slots the signed-in player has already
  // locked. Without this the briefing always reads "you haven't called your
  // picks yet" even after a full lock-in (PHA-883). Count distinct filled
  // slots so a re-saved pick can't inflate the tally past the slot count.
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
      return {
        playerId: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        score: score.total,
        isSelf: session?.playerId === p.id,
      };
    })
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  const selfIdx = standings.findIndex((r) => r.isSelf);
  const selfRow = selfIdx >= 0 ? standings[selfIdx] : null;
  const leader = standings[0];

  // Show top 4, but if "you" sit further down, swap them in at position 4 so
  // the panel always shows the player's own row.
  const top: typeof standings = standings.slice(0, 4);
  if (selfRow && !top.some((r) => r.isSelf)) {
    top[3] = selfRow;
  }

  const eventStarted = resolvedRows.length > 0;
  const eventLabel = eventStarted ? "Live now" : "Pre-event";

  return (
    <>
      {/* Eyebrow */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="eyebrow">
          {layout.name.replace("CS2 ", "").replace("Major | ", " · ")} · <b>{eventLabel}</b>
        </span>
      </div>

      {/* Stage briefing */}
      <section className="brk" style={{
        position: "relative",
        background: "var(--surf-1)",
        border: "1px solid var(--hair-2)",
        padding: "26px 28px 28px",
        overflow: "hidden",
      }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <div style={{
          position: "absolute",
          right: -20,
          top: "50%",
          transform: "translateY(-50%)",
          width: 240,
          height: 240,
          opacity: 0.05,
          pointerEvents: "none",
        }}>
          <HeatMark size={240} />
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <span className="eyebrow-mono">
              [ STAGE_{String(activeNumber).padStart(2, "0")} ]
            </span>
            <StageStatusTag pickability={active.pick} />
          </div>
          <h1 className="font-display" style={{
            fontWeight: 800,
            fontSize: "clamp(34px, 5vw, 48px)",
            textTransform: "uppercase",
            lineHeight: 0.92,
            marginBottom: 14,
          }}>
            {activeLabel}
          </h1>
          <StageBody
            pickability={active.pick}
            sectionName={activeLabel}
            signedIn={!!session}
            filledSlots={selfFilledSlots}
            totalSlots={activeSlotCount}
          />
          {active.pick.pickable && (
            <div style={{ marginTop: 16 }}>
              <LockCountdown lockAt={lockTimeForSection(active.section.sectionid)} />
            </div>
          )}
          <div style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 18,
          }}>
            {active.pick.pickable ? (
              <Link
                href={`/picks?section=${active.section.sectionid}`}
                className="btn-heat"
              >
                {session
                  ? selfPickComplete
                    ? "Edit Picks"
                    : selfFilledSlots > 0
                      ? "Finish Picks"
                      : "Make Picks"
                  : "Make Picks"}
                <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            ) : (
              <Link
                href={`/picks?section=${active.section.sectionid}`}
                className="btn-heat"
              >
                {active.pick.reason === "locked-time-passed" && session
                  ? "Check Your Picks"
                  : "View Stage"}
                <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            )}
            <Link href="/leaderboard" className="btn-ghost">View Ranks</Link>
          </div>
        </div>
      </section>

      {/* Stats + Leaderboard cols */}
      <div className="dash-cols">
        {session ? (
          <div className="stat-row">
            <div className="stat brk">
              <span className="br-tr" />
              <span className="br-bl" />
              <div className="lbl">[ YOUR_RANK ]</div>
              <div className="val">
                {selfIdx >= 0 ? (
                  <>
                    {selfIdx + 1}
                    <small>{ordSuffix(selfIdx + 1)}</small>
                  </>
                ) : (
                  "—"
                )}
              </div>
              <div className={
                "sub" +
                (selfRow && leader && selfRow.score < leader.score ? " warn" : "")
              }>
                {selfRow && leader
                  ? selfIdx === 0
                    ? "Leading the board"
                    : `${leader.score - selfRow.score} from the leader`
                  : "No picks scored yet"}
              </div>
            </div>
            <div className="stat brk">
              <span className="br-tr" />
              <span className="br-bl" />
              <div className="lbl">[ POINTS ]</div>
              <div className="val foil">{selfRow?.score ?? 0}</div>
              <div className="sub">
                of {maxPoints} · {activeLabel}{" "}
                {active.pick.pickable
                  ? "open"
                  : active.pick.reason === "locked-time-passed"
                    ? "live"
                    : "pending"}
              </div>
            </div>
          </div>
        ) : (
          <Link href="/login/auth" className="panel brk" style={{
            display: "block",
            textDecoration: "none",
            color: "inherit",
            background: "rgba(240,163,0,0.04)",
            borderColor: "var(--hair-3)",
          }}>
            <span className="br-tr" />
            <span className="br-bl" />
            <div className="panel-title">[ Get In ]</div>
            <h2 className="font-display" style={{
              fontWeight: 800,
              fontSize: 24,
              textTransform: "uppercase",
              color: "var(--ink-hi)",
              margin: "0 0 8px",
            }}>
              Connect Steam
            </h2>
            <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: 0 }}>
              Sync your Valve picks, save locally, and climb the board.
            </p>
          </Link>
        )}

        <div className="panel brk">
          <span className="br-tr" />
          <span className="br-bl" />
          <div className="panel-title">
            [ Leaderboard · Top 4 ]
            <Link href="/leaderboard" className="link">Full board →</Link>
          </div>
          {top.length === 0 ? (
            <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: 0 }}>
              No players yet. Be the first.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {top.map((row, idx) => {
                const rank = selfRow && row.isSelf && selfIdx >= 0
                  ? selfIdx + 1
                  : idx + 1;
                return <LeaderRow key={row.playerId} rank={rank} row={row} />;
              })}
            </div>
          )}
        </div>
      </div>

      {/* Wire panel */}
      <section className="panel brk">
        <span className="br-tr" />
        <span className="br-bl" />
        <div className="panel-title">
          [ Wire ]
          <Link href="/news" className="link">All news →</Link>
        </div>
        {wireItems.length > 0 ? (
          <WireFeed items={wireItems} now={now} variant="compact" />
        ) : (
          <div style={{ color: "var(--ink-mid)", fontSize: 13 }}>
            The wire is quiet. Headlines drop on{" "}
            <Link href="/news" style={{ color: "var(--heat)" }}>News</Link>.
          </div>
        )}
      </section>

      {/* Watch the official streams (PHA-942) — sits below everything else */}
      <WatchNow />

      <style>{`
        .dash-cols { display: grid; grid-template-columns: 1fr; gap: 14px; }
        .stat-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (min-width: 1024px) {
          .dash-cols { grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
        }
      `}</style>
    </>
  );
}

function StageStatusTag({
  pickability,
}: {
  pickability: ReturnType<typeof isStagePickable>;
}) {
  if (pickability.pickable) {
    return <span className="live-tag">Picks Open</span>;
  }
  if (pickability.reason === "locked-time-passed") {
    return (
      <span className="live-tag" style={{ color: "var(--ink-mid)", borderColor: "var(--hair-2)", background: "var(--surf-2)" }}>
        Underway · Locked
      </span>
    );
  }
  if (pickability.reason === "locked-by-valve") {
    return (
      <span className="live-tag" style={{ color: "var(--ink-mid)", borderColor: "var(--hair-2)", background: "var(--surf-2)" }}>
        Locked by Valve
      </span>
    );
  }
  if (pickability.reason === "teams-not-set") {
    return (
      <span className="live-tag" style={{ color: "var(--ink-mid)", borderColor: "var(--hair-2)", background: "var(--surf-2)" }}>
        Teams not set
      </span>
    );
  }
  return null;
}

function StageBody({
  pickability,
  sectionName,
  signedIn,
  filledSlots,
  totalSlots,
}: {
  pickability: ReturnType<typeof isStagePickable>;
  sectionName: string;
  signedIn: boolean;
  filledSlots: number;
  totalSlots: number;
}) {
  const complete = totalSlots > 0 && filledSlots >= totalSlots;
  const text = pickability.pickable
    ? signedIn
      ? complete
        ? `Your ${sectionName} picks are locked in — all ${totalSlots} slots set. Tweak them anytime before the window shuts.`
        : filledSlots > 0
          ? `${filledSlots} of ${totalSlots} ${sectionName} slots locked. Finish the rest — who goes 3‑0, who crashes 0‑3, your advancing eight — before the window shuts.`
          : `You haven't called your ${sectionName} picks yet. Lock who goes 3‑0, who crashes 0‑3, and your advancing eight before the window shuts.`
      : `Pick window is open. Sign in to lock your ${sectionName} picks before the window shuts.`
    : pickability.reason === "teams-not-set"
      ? `Teams for ${sectionName} aren't seeded yet. Picks open automatically once Valve sets the bracket.`
      : pickability.reason === "locked-time-passed"
        ? signedIn
          ? `${sectionName} is underway — picks are locked. Check how your picks are tracking on the live bracket, keep an eye on the leaderboard, and catch the matches below.`
          : `${sectionName} is underway — picks are locked. Follow the live bracket, the leaderboard, and the matches below.`
        : pickability.reason === "locked-by-valve"
          ? `Valve has closed the pick window for ${sectionName}. Watch the wire for results.`
          : "This stage isn't available.";

  return (
    <p style={{
      fontSize: 14,
      color: "var(--ink-mid)",
      margin: 0,
      maxWidth: 440,
      textWrap: "pretty",
    }}>
      {text}
    </p>
  );
}

function LeaderRow({
  rank,
  row,
}: {
  rank: number;
  row: { playerId: string; displayName: string; avatarUrl: string | null; score: number; isSelf: boolean };
}) {
  return (
    <Link
      href={`/players/${encodeURIComponent(row.playerId)}`}
      style={{
        display: "grid",
        gridTemplateColumns: "24px 26px 1fr auto",
        gap: 11,
        alignItems: "center",
        padding: "10px 13px",
        background: row.isSelf ? "rgba(240,163,0,0.07)" : "var(--surf-1)",
        border: row.isSelf ? "1px solid var(--hair-3)" : "1px solid var(--hair)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--heat)",
      }}>
        {String(rank).padStart(2, "0")}
      </span>
      <span style={{
        width: 26,
        height: 26,
        borderRadius: "var(--r-sm)",
        background: row.avatarUrl
          ? `center/cover no-repeat url(${JSON.stringify(row.avatarUrl)})`
          : "linear-gradient(135deg, var(--surf-3), var(--surf-2))",
        border: "1px solid var(--hair)",
      }} />
      <span style={{ fontSize: 13, fontWeight: 500 }}>
        {row.displayName}
        {row.isSelf && (
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 8,
            letterSpacing: "0.1em",
            color: "var(--ink-low)",
            marginLeft: 7,
            textTransform: "uppercase",
          }}>
            · you
          </span>
        )}
      </span>
      <span style={{
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        fontSize: 16,
        color: "var(--ink-hi)",
      }}>
        {row.score}
      </span>
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
