import { Logo } from "@/components/ui/Logo";
import { getCommittedLayout } from "@/lib/layout";
import { prisma } from "@/lib/db";
import { buildResolvedKeys, isStagePickable } from "@/lib/stage-gate-core";

const EVENT_ID = 26;

// Stage lock state depends on live StageOutcome rows — render fresh each
// request so the home page unlocks the next stage automatically as ingestion
// resolves results (PHA-841).
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const layout = getCommittedLayout();

  // PHA-841: reflect the same stage-pickability gate the /picks page enforces.
  const resolvedRows = await prisma.stageOutcome.findMany({
    where: { eventId: EVENT_ID },
    select: { sectionId: true, groupId: true, slotIndex: true },
  });
  const resolvedKeys = buildResolvedKeys(resolvedRows);

  return (
    <div style={{ padding: "var(--space-4)", minHeight: "100dvh" }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-4) 0 var(--space-6)",
          borderBottom: "1px solid var(--bg3)",
          marginBottom: "var(--space-6)",
        }}
      >
        <Logo size={32} />
        <a
          href="/profile"
          aria-label="Your profile"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "4px 12px 4px 4px",
            borderRadius: "999px",
            background: "var(--bg3)",
            color: "var(--text-mid)",
            textDecoration: "none",
            minHeight: 36,
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "var(--bg2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.9375rem",
            }}
          >
            ◎
          </span>
          <span
            style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 700,
              fontSize: "0.75rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-hi)",
            }}
          >
            You
          </span>
        </a>
      </header>

      {/* Event banner */}
      <section
        style={{
          background: "var(--bg1)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-6)",
          marginBottom: "var(--space-4)",
          border: "1px solid var(--bg3)",
        }}
      >
        <p
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--accent)",
            marginBottom: "var(--space-1)",
          }}
        >
          Active Event
        </p>
        <h1
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "var(--text-hi)",
            margin: 0,
          }}
        >
          {layout.name}
        </h1>
        <p style={{ color: "var(--text-mid)", fontSize: "0.875rem", marginTop: "var(--space-2)", marginBottom: 0 }}>
          June 2–21, 2026 · Cologne, Germany · {layout.teams.length} teams
        </p>
      </section>

      {/* Stages */}
      <section style={{ marginBottom: "var(--space-4)" }}>
        <h2
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-low)",
            margin: "0 0 var(--space-3)",
          }}
        >
          Stages
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {layout.sections.map((section) => {
            const group = section.groups[0];
            const ptsPerPick = group?.points_per_pick ?? 0;
            const picks = group?.picks?.length ?? 0;
            const isPlayoff = section.sectionid >= 108;
            const pick = isStagePickable(layout, resolvedKeys, section.sectionid);
            const locked = !pick.pickable;

            const label = section.name.split(" | ")[0];
            const subline = locked
              ? pick.reason === "previous-stage-unresolved"
                ? `Opens after ${pick.previousSectionName}`
                : pick.reason === "locked-by-valve"
                  ? "Locked by Valve"
                  : "Locked"
              : `${picks} picks · ${ptsPerPick} pt${ptsPerPick !== 1 ? "s" : ""}/pick`;

            const cardStyle = {
              background: "var(--bg1)",
              border: locked ? "1px dashed var(--bg3)" : "1px solid var(--bg3)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              textDecoration: "none",
              color: "inherit",
              opacity: locked ? 0.7 : 1,
              cursor: locked ? "not-allowed" : "pointer",
              transition: `background var(--duration-fast) var(--ease-sharp)`,
            } as const;

            const inner = (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  {locked && (
                    <span aria-hidden="true" style={{ fontSize: "0.95rem", color: "var(--text-low)" }}>
                      {"\u{1F512}"}
                    </span>
                  )}
                  <div>
                    <p
                      style={{
                        fontFamily: "'Rajdhani', sans-serif",
                        fontWeight: 600,
                        fontSize: "1rem",
                        color: locked ? "var(--text-mid)" : "var(--text-hi)",
                        margin: 0,
                      }}
                    >
                      {label}
                    </p>
                    <p style={{ color: "var(--text-mid)", fontSize: "0.75rem", margin: "2px 0 0" }}>
                      {subline}
                    </p>
                  </div>
                </div>
                <span style={{ color: "var(--text-low)", fontSize: "1rem" }}>
                  {locked ? "" : "›"}
                </span>
              </>
            );

            if (locked) {
              return (
                <div
                  key={section.sectionid}
                  role="link"
                  aria-disabled="true"
                  title={subline}
                  style={cardStyle}
                >
                  {inner}
                </div>
              );
            }

            return (
              <a
                key={section.sectionid}
                href={isPlayoff ? "/playoffs" : `/picks?section=${section.sectionid}`}
                style={cardStyle}
              >
                {inner}
              </a>
            );
          })}
        </div>
      </section>

      {/* Quick links */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
        <a
          href="/leaderboard"
          style={{
            background: "var(--bg1)",
            border: "1px solid var(--bg3)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-4)",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <p style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: "1rem", color: "var(--accent)", margin: 0 }}>
            Leaderboard
          </p>
          <p style={{ color: "var(--text-mid)", fontSize: "0.75rem", margin: "2px 0 0" }}>View rankings</p>
        </a>
        <a
          href="/login"
          style={{
            background: "var(--bg1)",
            border: "1px solid var(--bg3)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-4)",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <p style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)", margin: 0 }}>
            Connect Steam
          </p>
          <p style={{ color: "var(--text-mid)", fontSize: "0.75rem", margin: "2px 0 0" }}>Sync your picks</p>
        </a>
      </section>
    </div>
  );
}
