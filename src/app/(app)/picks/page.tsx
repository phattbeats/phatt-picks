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
  type StagePickability,
} from "@/lib/stage-gate-core";
import { LockCountdown } from "@/components/heat/LockCountdown";
import { lockTimeForSection, isLockTimePassed } from "@/lib/lock-schedule-core";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { isSwissSection, bucketSwissSlots } from "@/lib/swiss-bucket-core";
import { buildSwissStandings, type SlotPickMap } from "@/lib/swiss-standings-core";
import { LiveSwissBracket } from "@/components/heat/LiveSwissBracket";
import { LiveSwissStandings } from "@/components/heat/LiveSwissStandings";
import { refreshStandingsOnRead, getSwissStandings } from "@/lib/swiss-results";
import { AutoRefresh } from "@/components/AutoRefresh";

const EVENT_ID = 26;

export const dynamic = "force-dynamic";

export default async function PicksPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
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

  // Signed in via Steam but no auth code yet: picks save in HOTLINE, but we
  // can't push them to the official in-game CS2 Pick'Em until they connect a
  // Game Authentication Code. Surface that gap up front with a link (PHA-891).
  const needsSteamLink = session?.steamId
    ? !(await hasAuthCode(session.playerId))
    : false;

  const activeSectionId = params.section
    ? parseInt(params.section, 10)
    : layout.sections[0].sectionid;

  const section = layout.sections.find((s) => s.sectionid === activeSectionId);

  // Scheduled hard lock (PHA-886/898): once a stage's first match starts, its
  // pick window is closed — even though the committed layout still says
  // picks_allowed and an outcome row hasn't landed yet. The published schedule
  // is the truthful signal; the gate surfaces `locked-time-passed` (friendlier
  // copy that introduces the live lineup below) and POST /api/picks mirrors the
  // same lock. Playoffs have no published time (null) → unaffected.
  const sectionPickability: Map<number, StagePickability> = new Map(
    layout.sections.map((s) => [
      s.sectionid,
      isStagePickable(layout, s.sectionid, {
        lockedByTime: isLockTimePassed(s.sectionid, nowMs),
      }),
    ]),
  );
  const activePickability =
    sectionPickability.get(activeSectionId) ??
    ({ pickable: false, reason: "unknown-section" } as StagePickability);

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
  const showLineup =
    !!section && !activePickability.pickable && isSwissSection(activeSectionId);
  let swissStandings: ReturnType<typeof buildSwissStandings> | null = null;
  let outcomeResolvedAtIso: string | null = null;
  // Live HLTV/BLAST-style W-L standings (PHA-902): the running win-loss table the
  // Valve answer key can't provide. Hourly on-read refresh, graceful-empty.
  let liveStandings: Awaited<ReturnType<typeof getSwissStandings>> = null;
  if (showLineup && section) {
    await refreshStandingsOnRead(EVENT_ID, activeSectionId); // ~1h claim, deferred crawl
    liveStandings = await getSwissStandings(
      EVENT_ID,
      activeSectionId,
      layout.teams.map((t) => ({ pickid: t.pickid, name: t.name })),
    );
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
    swissStandings = buildSwissStandings(
      section,
      outcomesForSection as SlotPickMap,
      bucketSwissSlots,
      myPicks as SlotPickMap,
    );
  }

  const activeIdx = layout.sections.findIndex((s) => s.sectionid === activeSectionId);
  const activeLabel = section?.name.split(" | ")[0] ?? "Picks";
  const activeNumber = activeIdx >= 0 ? activeIdx + 1 : 1;

  return (
    <>
      {/* Stage header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">[ STAGE_{String(activeNumber).padStart(2, "0")} ]</span>
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
        {layout.sections.map((s) => {
          const active = s.sectionid === activeSectionId;
          const label = s.name.split(" | ")[0];
          const pick = sectionPickability.get(s.sectionid)!;
          const locked = !pick.pickable;

          const lockTitle =
            pick.pickable
              ? undefined
              : pick.reason === "teams-not-set"
                ? "Locked — teams not set yet"
                : pick.reason === "locked-by-valve"
                  ? "Locked by Valve"
                  : "Locked";

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

          // Every tab is navigable — a locked stage is "can't pick", not "can't
          // look": clicking it shows that stage's content (its live lineup /
          // your build, or a "teams not set" card). Previously a locked,
          // non-active tab rendered as a disabled span, so once you left Stage I
          // you couldn't click back to view it (Brandon, 2026-06-03). The 🔒
          // still flags that picks are closed.
          return (
            <Link
              key={s.sectionid}
              href={`/picks?section=${s.sectionid}`}
              title={lockTitle}
              aria-current={active ? "page" : undefined}
              style={baseStyle}
            >
              {locked && <span aria-hidden="true">🔒</span>}
              {label}
            </Link>
          );
        })}
      </div>

      {/* Stage content */}
      {!section ? (
        <p style={{ color: "var(--ink-mid)" }}>Section not found.</p>
      ) : activePickability.pickable ? (
        <PicksBoard
          section={section}
          teams={layout.teams}
          initialPicks={myPicks}
          enabled={!!session}
          eventId={EVENT_ID}
          steamLinked={!!session?.steamId}
        />
      ) : swissStandings ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <LockedStageCard pickability={activePickability} compact />
          <LiveSwissBracket
            standings={swissStandings}
            teamMap={buildTeamMap(layout)}
            signedIn={!!session}
            resolvedAtIso={outcomeResolvedAtIso}
          />
          {/* Live HLTV-style W-L standings for the whole field, under the build
              (PHA-902). Hidden until the first hourly crawl lands. */}
          {liveStandings && (
            <LiveSwissStandings
              rows={liveStandings.rows}
              teamMap={buildTeamMap(layout)}
              userPickedPickids={
                new Set(
                  Object.values(myPicks).flatMap((g) =>
                    Object.values(g).filter((id) => id !== 0),
                  ),
                )
              }
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
        [ SAVED HERE — NOT ON STEAM YET ]
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
}: {
  pickability: StagePickability;
  /** Tighter card used as a banner above the live lineup. */
  compact?: boolean;
}) {
  const heading =
    pickability.pickable
      ? "Locked"
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
      : pickability.reason === "teams-not-set"
        ? "Teams for this stage aren't seeded yet. Picks open automatically once Valve sets the bracket."
        : pickability.reason === "locked-time-passed"
          ? "This stage has begun, so picks are locked. Track how the teams you called are doing in the live lineup below."
          : pickability.reason === "locked-by-valve"
            ? "Valve closed the pick window for this stage. Results will appear here as matches complete."
            : "This stage isn't available.";

  return (
    <div
      className="panel brk"
      style={{ textAlign: "center", padding: compact ? "20px 22px" : "40px 24px" }}
    >
      <span className="br-tr" />
      <span className="br-bl" />
      <div aria-hidden="true" style={{
        fontSize: compact ? "1.25rem" : "1.75rem",
        marginBottom: compact ? 8 : 12,
        color: "var(--heat)",
      }}>
        🔒
      </div>
      <h2 className="font-display" style={{
        fontWeight: 800,
        fontSize: compact ? 18 : 22,
        textTransform: "uppercase",
        letterSpacing: 0,
        color: "var(--ink-hi)",
        margin: "0 0 8px",
      }}>
        {heading}
      </h2>
      {subline && (
        <p style={{
          color: "var(--ink-mid)",
          fontSize: compact ? 13 : 14,
          margin: 0,
          maxWidth: 420,
          marginInline: "auto",
          lineHeight: 1.5,
        }}>
          {subline}
        </p>
      )}
    </div>
  );
}
