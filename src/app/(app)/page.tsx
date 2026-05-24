import { Logo } from "@/components/ui/Logo";
import { getCommittedLayout } from "@/lib/layout";

export default function DashboardPage() {
  const layout = getCommittedLayout();

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
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "var(--bg3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-mid)",
            textDecoration: "none",
            fontSize: "1rem",
          }}
        >
          ◎
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

            return (
              <a
                key={section.sectionid}
                href={isPlayoff ? "/playoffs" : `/picks?section=${section.sectionid}`}
                style={{
                  background: "var(--bg1)",
                  border: "1px solid var(--bg3)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  textDecoration: "none",
                  color: "inherit",
                  transition: `background var(--duration-fast) var(--ease-sharp)`,
                }}
              >
                <div>
                  <p
                    style={{
                      fontFamily: "'Rajdhani', sans-serif",
                      fontWeight: 600,
                      fontSize: "1rem",
                      color: "var(--text-hi)",
                      margin: 0,
                    }}
                  >
                    {section.name.split(" | ")[0]}
                  </p>
                  <p style={{ color: "var(--text-mid)", fontSize: "0.75rem", margin: "2px 0 0" }}>
                    {picks} picks · {ptsPerPick} pt{ptsPerPick !== 1 ? "s" : ""}/pick
                  </p>
                </div>
                <span style={{ color: "var(--text-low)", fontSize: "1rem" }}>›</span>
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
