import Link from "next/link";
import { getCommittedLayout } from "@/lib/layout";
import { getSession } from "@/lib/session";
import { hasAuthCode } from "@/lib/authcode";
import { prisma } from "@/lib/db";
import { mirrorPlayerPredictionsThrottled } from "@/lib/predictions-sync";
import { PicksBoard } from "@/components/PicksBoard";
import {
  buildResolvedKeys,
  isStagePickable,
  type StagePickability,
} from "@/lib/stage-gate-core";
import { LockCountdown } from "@/components/heat/LockCountdown";
import { lockTimeForSection } from "@/lib/lock-schedule-core";

const EVENT_ID = 26;

export default async function PicksPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const params = await searchParams;
  const layout = getCommittedLayout();
  const session = await getSession();

  if (session?.steamId) {
    await mirrorPlayerPredictionsThrottled(session.playerId, EVENT_ID);
  }

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

  const resolvedRows = await prisma.stageOutcome.findMany({
    where: { eventId: EVENT_ID },
    select: { sectionId: true, groupId: true, slotIndex: true },
  });
  const resolvedKeys = buildResolvedKeys(resolvedRows);

  const sectionPickability: Map<number, StagePickability> = new Map(
    layout.sections.map((s) => [
      s.sectionid,
      isStagePickable(layout, resolvedKeys, s.sectionid),
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
              : pick.reason === "previous-stage-unresolved"
                ? `Locked — opens after ${pick.previousSectionName}`
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
            cursor: locked && !active ? "not-allowed" : "pointer",
            boxShadow: active ? "0 0 0 0px var(--heat)" : "none",
          };

          if (locked && !active) {
            return (
              <span key={s.sectionid} role="link" aria-disabled="true" title={lockTitle} style={baseStyle}>
                <span aria-hidden="true">🔒</span>
                {label}
              </span>
            );
          }

          return (
            <Link key={s.sectionid} href={`/picks?section=${s.sectionid}`} style={baseStyle}>
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

function LockedStageCard({ pickability }: { pickability: StagePickability }) {
  const heading =
    pickability.pickable
      ? "Locked"
      : pickability.reason === "previous-stage-unresolved"
        ? `Opens after ${pickability.previousSectionName}`
        : pickability.reason === "locked-by-valve"
          ? "Locked by Valve"
          : "Locked";
  const subline =
    pickability.pickable
      ? undefined
      : pickability.reason === "previous-stage-unresolved"
        ? "Teams for this stage aren't set yet. Picks open automatically once the previous stage's results are in."
        : pickability.reason === "locked-by-valve"
          ? "Valve closed the pick window for this stage. Results will appear here as matches complete."
          : "This stage isn't available.";

  return (
    <div className="panel brk" style={{ textAlign: "center", padding: "40px 24px" }}>
      <span className="br-tr" />
      <span className="br-bl" />
      <div aria-hidden="true" style={{
        fontSize: "1.75rem",
        marginBottom: 12,
        color: "var(--heat)",
      }}>
        🔒
      </div>
      <h2 className="font-display" style={{
        fontWeight: 800,
        fontSize: 22,
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
          fontSize: 14,
          margin: 0,
          maxWidth: 360,
          marginInline: "auto",
          lineHeight: 1.5,
        }}>
          {subline}
        </p>
      )}
    </div>
  );
}
