/**
 * Live Swiss W-L standings (#902) — the HLTV/BLAST-style table, Singapore skin
 * (hairline rows, status as a mono tag).
 *
 * Renders UNDER the viewer's build on a locked Swiss stage: every team in the
 * stage with its running win-loss record, round differential, and advance /
 * eliminated status, sourced live from the HLTV event page (refreshed hourly,
 * server-side). Where LiveSwissBracketBoard shows "what you called" off Valve's
 * answer key, this shows "what's actually happening" off a real results feed —
 * the running record Valve's Pick'Em never exposes.
 *
 * Server component: the data is fetched + cached upstream (getSwissStandings);
 * the <AutoRefresh> already on the picks page re-renders the route so the table
 * tracks results without a reload. This is the neutral league table — it does NOT
 * highlight the viewer's picks (Brandon: the table is good, drop the "your pick"
 * part; that belongs to the build above). Honest: every number is the source's.
 */

import Link from "next/link";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { LastUpdated } from "@/components/LastUpdated";
import { teamHref } from "@/components/sg/teams/team-assets";
import {
  summarizeStandings,
  type SwissResultStatus,
  type StandingRow,
} from "@/lib/swiss-results-core";

const STATUS_META: Record<SwissResultStatus, { label: string; cls: string }> = {
  advanced: { label: "Adv", cls: "tag ok" },
  eliminated: { label: "Out", cls: "tag crit" },
  live: { label: "Live", cls: "tag" },
};

export function LiveSwissStandings({
  rows,
  teamMap,
  source,
  sourceUrl,
  fetchedAtIso,
}: {
  rows: StandingRow[];
  teamMap: Map<number, TeamDef>;
  source: string;
  sourceUrl: string;
  fetchedAtIso: string;
}) {
  if (rows.length === 0) return null;
  const summary = summarizeStandings(rows);

  return (
    <section className="sgb-board">
      <div className="sect-head">
        <h2 className="display sgb-h">Standings</h2>
        <span className="last-updated">
          <LastUpdated iso={fetchedAtIso} />
        </span>
      </div>

      <p className="sgb-copy">
        Every team&apos;s live win-loss record.
        {summary.advanced > 0 && (
          <>
            {" "}
            <b className="ok">{summary.advanced} through</b>
          </>
        )}
        {summary.eliminated > 0 && (
          <>
            {summary.advanced > 0 ? " · " : " "}
            <b className="crit">{summary.eliminated} out</b>
          </>
        )}
        .
      </p>

      <div className="std-table">
        <div className="std-row std-head" aria-hidden="true">
          <span className="r">#</span>
          <span>Team</span>
          <span className="c">W-L</span>
          <span className="c std-rd">RD</span>
          <span className="r">Status</span>
        </div>

        {rows.map((row, i) => {
          const team = row.pickid != null ? teamMap.get(row.pickid) : undefined;
          const meta = STATUS_META[row.status];
          return (
            <div key={`${row.pickid ?? row.name}:${i}`} className={`std-row std-${row.status}`}>
              {/* seed / position */}
              <span className="r std-pos">{row.seed != null ? `#${row.seed}` : i + 1}</span>

              {/* team */}
              <span className="std-team">
                {team ? (
                  <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={28} />
                ) : (
                  <span aria-hidden="true" className="std-mono">{row.name.slice(0, 2).toUpperCase()}</span>
                )}
                {team ? (
                  <Link href={teamHref(team)} prefetch={false} className="std-name">
                    {team.name}
                  </Link>
                ) : (
                  <span className="std-name">{row.name}</span>
                )}
              </span>

              {/* record */}
              <span className="c std-rec">
                {row.wins}-{row.losses}
              </span>

              {/* round diff */}
              <span className={`c std-rd${row.roundDiff > 0 ? " pos" : row.roundDiff < 0 ? " neg" : ""}`}>
                {row.roundDiff > 0 ? `+${row.roundDiff}` : row.roundDiff}
              </span>

              {/* status */}
              <span className="r">
                <span className={meta.cls}>{meta.label}</span>
              </span>
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
