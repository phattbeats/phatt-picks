import { MatchTime } from "@/components/heat/MatchTime";

/**
 * Playoff schedule strip (#1007), Singapore skin.
 *
 * Brandon: "stages ship with each game having its date and time attached."
 * The playoffs are one Pick'Em stage spanning several games over a few days, so
 * rather than cram a time into each bracket cell, the games' dates+times live
 * here — a hairline schedule grouped by round, each game showing its slot in
 * the viewer's local clock.
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
  // Stay dark until at least one game has a published time; once any does,
  // list every game, the unscheduled ones as "Time TBA" (PHA-5538).
  const withTimes = rounds.filter((r) => r.games.length > 0);
  if (!rounds.some((r) => r.games.some((g) => g.iso))) return null;

  return (
    <section className="sgb-sched">
      <div className="sect-head">
        <h2 className="display sgb-h">Schedule</h2>
        <span className="mono muted sgb-tz">Your local time</span>
      </div>
      <div className="sgb-sched-rounds">
        {withTimes.map((r) => (
          <div key={r.short} className="sgb-sched-rd">
            <span className="eyebrow">
              <b>{r.short}</b> · {r.label}
            </span>
            <div className="hair-list">
              {r.games.map((g, i) => (
                <div key={i} className="sgb-sched-row">
                  <span className="t">{g.label}</span>
                  <MatchTime iso={g.iso} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
