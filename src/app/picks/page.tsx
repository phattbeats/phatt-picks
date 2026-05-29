import { getCommittedLayout } from "@/lib/layout";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { mirrorPlayerPredictionsThrottled } from "@/lib/predictions-sync";
import { MobileNav } from "@/components/ui/MobileNav";
import { PicksBoard } from "@/components/PicksBoard";

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
            return (
              <a
                key={s.sectionid}
                href={`/picks?section=${s.sectionid}`}
                style={{
                  flexShrink: 0,
                  padding: "var(--space-2) var(--space-4)",
                  borderRadius: "var(--radius-sm)",
                  background: active ? "var(--accent)" : "var(--bg2)",
                  color: active ? "#fff" : "var(--text-mid)",
                  textDecoration: "none",
                  fontFamily: "'Rajdhani', sans-serif",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  minHeight: 44,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {label}
              </a>
            );
          })}
        </div>

        {/* Stage content */}
        {section ? (
          <PicksBoard
            section={section}
            teams={layout.teams}
            initialPicks={myPicks}
            enabled={!!session}
            eventId={EVENT_ID}
          />
        ) : (
          <p style={{ color: "var(--text-mid)" }}>Section not found.</p>
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
