import { getCommittedLayout } from "@/lib/layout";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { mirrorPlayerPredictionsThrottled } from "@/lib/predictions-sync";
import { MobileNav } from "@/components/ui/MobileNav";
import { PicksBoard } from "@/components/PicksBoard";
import {
  buildResolvedKeys,
  isStagePickable,
  type StagePickability,
} from "@/lib/stage-gate-core";

const EVENT_ID = 26;

export default async function PicksPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const params = await searchParams;
  const layout = getCommittedLayout();
  const session = await getSession();

  // Connected players: pull live Valve picks into the Pick table before reading
  // (throttled + graceful — a Valve outage just falls back to stored picks).
  // Local players have no steamId and skip this path entirely (rule #6).
  if (session?.steamId) {
    await mirrorPlayerPredictionsThrottled(session.playerId, EVENT_ID);
  }

  // Default to first section (sectionid 105)
  const activeSectionId = params.section
    ? parseInt(params.section, 10)
    : layout.sections[0].sectionid;

  const section = layout.sections.find((s) => s.sectionid === activeSectionId);

  // PHA-841: gate downstream stages until previous-stage outcomes resolve.
  // The committed layout ships every stage `picks_allowed:true` and the
  // playoff sections carry `pickid:0` placeholders — without this gate the
  // UI lets players pick teams that haven't been determined yet.
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

  // Load player's picks if authenticated
  const myPicks: Record<number, Record<number, number>> = {}; // groupId → slotIndex → pickId
  if (session) {
    const picks = await prisma.pick.findMany({
      where: { playerId: session.playerId, eventId: EVENT_ID, sectionId: activeSectionId },
    });
    for (const pick of picks) {
      myPicks[pick.groupId] ??= {};
      myPicks[pick.groupId][pick.slotIndex] = pick.pickId;
    }
  }

  return (
    <>
      <div style={{ padding: "var(--space-4)", minHeight: "100dvh", position: "relative", zIndex: 1 }}>
        {/* Header */}
        <header style={{ marginBottom: "var(--space-4)" }}>
          <h1
            style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--text-hi)",
              margin: 0,
            }}
          >
            Picks
          </h1>
        </header>

        {/* Stage tabs */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            marginBottom: "var(--space-4)",
            overflowX: "auto",
            paddingBottom: "var(--space-1)",
          }}
        >
          {layout.sections.map((s) => {
            const active = s.sectionid === activeSectionId;
            const label = s.name.split(" | ")[0];
            const pick = sectionPickability.get(s.sectionid)!;
            const locked = !pick.pickable;
            const tabBg = active
              ? "var(--accent)"
              : locked
                ? "var(--bg1)"
                : "var(--bg2)";
            const tabColor = active
              ? "#fff"
              : locked
                ? "var(--text-low)"
                : "var(--text-mid)";
            const lockTitle =
              pick.pickable
                ? undefined
                : pick.reason === "previous-stage-unresolved"
                  ? `Locked — opens after ${pick.previousSectionName}`
                  : pick.reason === "locked-by-valve"
                    ? "Locked by Valve"
                    : "Locked";

            const tabStyle = {
              flexShrink: 0,
              padding: "var(--space-2) var(--space-4)",
              borderRadius: "var(--radius-sm)",
              background: tabBg,
              color: tabColor,
              textDecoration: "none",
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 600,
              fontSize: "0.875rem",
              letterSpacing: "0.05em",
              textTransform: "uppercase" as const,
              whiteSpace: "nowrap" as const,
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              gap: "var(--space-1)",
              opacity: locked && !active ? 0.7 : 1,
              border:
                locked && !active ? "1px dashed var(--bg3)" : "1px solid transparent",
              cursor: locked && !active ? "not-allowed" : "pointer",
            };

            // Locked, non-active tabs are inert: render a <span>, not an <a>.
            // The lock icon + title carry the affordance.
            if (locked && !active) {
              return (
                <span
                  key={s.sectionid}
                  role="link"
                  aria-disabled="true"
                  title={lockTitle}
                  style={tabStyle}
                >
                  <span aria-hidden="true" style={{ fontSize: "0.85em" }}>
                    {"\u{1F512}"}
                  </span>
                  {label}
                </span>
              );
            }

            return (
              <a key={s.sectionid} href={`/picks?section=${s.sectionid}`} style={tabStyle}>
                {label}
              </a>
            );
          })}
        </div>

        {/* Stage content */}
        {!section ? (
          <p style={{ color: "var(--text-mid)" }}>Section not found.</p>
        ) : activePickability.pickable ? (
          <PicksBoard
            section={section}
            teams={layout.teams}
            initialPicks={myPicks}
            enabled={!!session}
            eventId={EVENT_ID}
          />
        ) : (
          <LockedStageCard pickability={activePickability} />
        )}

        {!session && (
          <div
            style={{
              position: "fixed",
              bottom: "calc(72px + env(safe-area-inset-bottom))",
              left: 0,
              right: 0,
              background: "var(--bg1)",
              borderTop: "1px solid var(--bg3)",
              padding: "var(--space-4)",
              zIndex: 99,
            }}
          >
            <a
              href="/login"
              style={{
                display: "block",
                textAlign: "center",
                background: "var(--accent)",
                color: "#fff",
                borderRadius: "var(--radius-md)",
                padding: "12px",
                textDecoration: "none",
                fontFamily: "'Rajdhani', sans-serif",
                fontWeight: 700,
                fontSize: "1rem",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              Sign in to Save Picks
            </a>
          </div>
        )}
      </div>
      <MobileNav />
    </>
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
    <div
      style={{
        background: "var(--bg1)",
        border: "1px dashed var(--bg3)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-6)",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          fontSize: "2rem",
          marginBottom: "var(--space-3)",
          color: "var(--text-mid)",
        }}
      >
        {"\u{1F512}"}
      </div>
      <h2
        style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: 700,
          fontSize: "1.125rem",
          color: "var(--text-hi)",
          margin: "0 0 var(--space-2)",
          letterSpacing: "0.03em",
        }}
      >
        {heading}
      </h2>
      {subline && (
        <p
          style={{
            color: "var(--text-mid)",
            fontSize: "0.875rem",
            margin: 0,
            maxWidth: 320,
            marginInline: "auto",
            lineHeight: 1.5,
          }}
        >
          {subline}
        </p>
      )}
    </div>
  );
}
