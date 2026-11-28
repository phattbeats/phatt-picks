"use client";

/**
 * Swiss "Matches" list (PHA-5538): the stage's finished matches with their
 * scores and the scheduled ones with their start times, grouped by the
 * viewer's own calendar day (Today / Tomorrow / the date). Days already over
 * fold into a closed "results" row so the next match day sits on top.
 *
 * Data is HLTV's bracket cells, refreshed by the hourly standings crawl, so a
 * newly published round appears here on the next render (the picks page's
 * <AutoRefresh>). A match without a time sits under "Time to be announced".
 *
 * Spoiler-free (PHA-5495): inside <SpoilerFree>, `.sf-on` masks every score,
 * every record label ("2:0") and every pairing after round 1, which would give
 * the teams' records away. Start times and round numbers stay. Opacity only, so
 * nothing reflows when the toggle flips.
 */

import { TeamLogo } from "@/components/ui/TeamLogo";
import type { LogoTier } from "@/lib/logos";
import { groupByLocalDay, matchState, type DayGroup, type SchedMatch } from "@/lib/match-schedule-core";
import { LastUpdated } from "@/components/LastUpdated";
import { dayLabel, formatClock, formatDate, useNow } from "./MatchTime";

export interface SchedSideView {
  name: string | null;
  pickid: number | null;
  score: number | null;
  winner: boolean;
  /** Display name (layout name when matched, else HLTV's), null = TBD. */
  label: string | null;
  tiers: LogoTier[] | null;
  href: string | null;
}

export type SchedMatchView = SchedMatch<SchedSideView>;

export function MatchSchedule({
  matches,
  source,
  sourceUrl,
  fetchedAtIso,
  className,
}: {
  matches: SchedMatchView[];
  source: string;
  sourceUrl: string;
  fetchedAtIso: string;
  className?: string;
}) {
  const now = useNow();
  if (matches.length === 0) return null;
  // Until mounted we don't know the viewer's zone: one ungrouped list (no
  // headers, no times) that the browser regroups right after hydration.
  const groups: DayGroup<SchedMatchView>[] =
    now == null ? [{ key: "pending", rel: null, past: false, matches }] : groupByLocalDay(matches, now);
  const upcoming = matches.filter((m) => !m.played).length;

  return (
    <section className={className ? `sgb-board sch ${className}` : "sgb-board sch"}>
      <div className="sect-head">
        <h2 className="display sgb-h">Matches</h2>
        <span className="last-updated">
          <LastUpdated iso={fetchedAtIso} />
        </span>
      </div>
      <p className="sgb-copy">
        Results and the published schedule, in your local time.
        {upcoming > 0 && (
          <>
            {" "}
            <b>{upcoming} still to play.</b>
          </>
        )}
      </p>

      <div className="sch-days">
        {groups.map((g) => {
          const list = (
            <div className="sch-list">
              {g.matches.map((m) => (
                <MatchRow key={m.key} m={m} now={now} />
              ))}
            </div>
          );
          if (g.key === "pending") return <div key={g.key}>{list}</div>;
          const head = <DayHead g={g} now={now!} />;
          // A day that's over folds away; today and later stay open.
          if (g.past && g.matches.every((m) => m.played)) {
            return (
              <details key={g.key} className="sch-day past">
                <summary>
                  {head}
                  <span className="sch-count">
                    {g.matches.length} result{g.matches.length === 1 ? "" : "s"}
                  </span>
                </summary>
                {list}
              </details>
            );
          }
          return (
            <div key={g.key} className="sch-day">
              <div className="sch-dayrow">{head}</div>
              {list}
            </div>
          );
        })}
      </div>

      <p className="sgb-src">
        Source{" "}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
          {source}
        </a>{" "}
        · updates hourly
      </p>
    </section>
  );
}

function DayHead({ g, now }: { g: DayGroup<SchedMatchView>; now: number }) {
  if (g.key === "tba") return <span className="eyebrow sch-dayname">Time to be announced</span>;
  const first = g.matches[0].startTimeMs!;
  const rel = dayLabel(first, now);
  const date = formatDate(first);
  return (
    <span className="eyebrow sch-dayname">
      <b>{rel}</b>
      {rel !== date && <> · {date}</>}
    </span>
  );
}

function MatchRow({ m, now }: { m: SchedMatchView; now: number | null }) {
  const state = now == null ? (m.played ? "final" : "upcoming") : matchState(m, now);
  const cls = ["sch-row", `s-${state}`, m.spoilsRecords ? "sf-pair" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <span className="sch-when">
        <span className="sch-clock">
          {m.startTimeMs == null ? "TBA" : now == null ? " " : formatClock(m.startTimeMs)}
        </span>
        <span className="sch-meta">
          {/* Record label and round number share a cell: spoiler-free swaps
              the first (it reveals records) for the second. */}
          <span className="sch-swap">
            <span className="sch-rec">{m.record}</span>
            <span className="sch-rnd">R{m.round}</span>
          </span>
          {m.bestOf > 0 && <span className="sch-bo">Bo{m.bestOf}</span>}
        </span>
      </span>
      <span className="sch-pair">
        <Side side={m.team1} played={m.played} align="end" />
        <span className="sch-mid">
          <span className="sch-swap">
            <span className="sch-res">
              {state === "final" ? (
                <>
                  <span className={m.team1.winner ? "w" : undefined}>{m.team1.score ?? "–"}</span>
                  <span className="dash">–</span>
                  <span className={m.team2.winner ? "w" : undefined}>{m.team2.score ?? "–"}</span>
                </>
              ) : state === "live" ? (
                <span className="tag">Live</span>
              ) : (
                <span className="vs">vs</span>
              )}
            </span>
            <span className="sch-vs">
              <span className="vs">vs</span>
            </span>
          </span>
        </span>
        <Side side={m.team2} played={m.played} align="start" />
        <span className="sch-mask" aria-hidden="true">
          Pairing hidden
        </span>
      </span>
    </div>
  );
}

function Side({ side, played, align }: { side: SchedSideView; played: boolean; align: "start" | "end" }) {
  const lost = played && !side.winner;
  const cls = `sch-side ${align}${side.label == null ? " tbd" : ""}${lost ? " lo" : ""}${played && side.winner ? " won" : ""}`;
  const logo = side.tiers ? (
    <TeamLogo tiers={side.tiers} teamName={side.label ?? ""} size={22} />
  ) : (
    <span className="sch-mono" aria-hidden="true">
      {(side.label ?? "?").slice(0, 2).toUpperCase()}
    </span>
  );
  const name = side.label ?? "TBD";
  return (
    <span className={cls}>
      {logo}
      {side.href ? (
        <a href={side.href} className="sch-name">
          {name}
        </a>
      ) : (
        <span className="sch-name">{name}</span>
      )}
    </span>
  );
}
