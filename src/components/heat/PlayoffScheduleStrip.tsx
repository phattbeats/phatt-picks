import { GameTime } from "@/components/heat/GameTime";

/**
 * Playoff schedule strip (PHA-1007).
 *
 * Brandon: "stages ship with each game having its date and time attached."
 * The playoffs are one Pick'Em stage spanning several games over a few days, so
 * rather than cram a time into each cramped bracket cell, the games' dates+times
 * live here — a compact broadcast-style schedule above the bracket, grouped by
 * round, each game showing its slot in the viewer's local clock.
 *
 * TRUTHFUL BY CONSTRUCTION: a round only lists games that carry a committed time
 * (`iso`), and the whole strip renders NOTHING until at least one game is
 * scheduled — exactly the dark default the lock schedule keeps until the
 * authoritative playoff times are committed (lock-schedule-core).
 */
export interface ScheduleRound {
  short: string;
  label: string;
  games: { label: string; iso: string | null }[];
}

export function PlayoffScheduleStrip({ rounds }: { rounds: ScheduleRound[] }) {
  const withTimes = rounds
    .map((r) => ({ ...r, games: r.games.filter((g) => g.iso) }))
    .filter((r) => r.games.length > 0);

  if (withTimes.length === 0) return null; // no published times yet — stay dark

  return (
    <div className="panel" style={{ padding: "14px 16px 12px" }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--ink-mid)",
          marginBottom: 10,
        }}
      >
        Schedule
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {withTimes.map((r) => (
          <div key={r.short}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--ink-low)",
                marginBottom: 6,
              }}
            >
              {r.label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {r.games.map((g, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "5px 0",
                    borderTop: i === 0 ? "none" : "1px solid var(--hair)",
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--ink-hi)" }}>{g.label}</span>
                  <GameTime iso={g.iso} align="left" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
