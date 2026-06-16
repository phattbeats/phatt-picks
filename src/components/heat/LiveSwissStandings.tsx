/**
 * Live Swiss W-L standings (PHA-902) — the HLTV/BLAST-style table.
 *
 * Renders UNDER the viewer's build on a locked Swiss stage: every team in the
 * stage with its running win-loss record, round differential, and advance /
 * eliminated status, sourced live from the HLTV event page (refreshed hourly,
 * server-side). Where LiveSwissBracket shows "what you called" off Valve's
 * answer key, this shows "what's actually happening" off a real results feed —
 * the running record Valve's Pick'Em never exposes.
 *
 * Server component: the data is fetched + cached upstream (getSwissStandings);
 * the <AutoRefresh> already on the picks page re-renders the route so the table
 * tracks results without a reload. This is the neutral league table — it does NOT
 * highlight the viewer's picks (Brandon: the table is good, drop the "your pick"
 * part; that belongs to the build above). Honest: every number is the source's.
 */

import type { CSSProperties } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { LastUpdated } from "@/components/LastUpdated";
import {
  summarizeStandings,
  type SwissResultStatus,
  type StandingRow,
} from "@/lib/swiss-results-core";

const STATUS_META: Record<SwissResultStatus, { label: string; color: string }> = {
  advanced: { label: "ADV", color: "var(--tac-green, #9bd23c)" },
  eliminated: { label: "OUT", color: "var(--ember, #d8351c)" },
  live: { label: "LIVE", color: "var(--ink-mid)" },
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
    <div className="panel brk" style={{ padding: "20px 18px 22px" }}>
      <span className="br-tr" />
      <span className="br-bl" />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="eyebrow-mono" style={{ color: "var(--heat)" }}>
          LIVE STANDINGS
        </span>
        <span className="last-updated">
          <LastUpdated iso={fetchedAtIso} />
        </span>
      </div>

      <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "10px 0 0", lineHeight: 1.5 }}>
        Full Swiss table — every team&apos;s live win-loss record.
        {summary.advanced > 0 && (
          <>
            {" "}
            <strong style={{ color: "var(--tac-green, #9bd23c)" }}>{summary.advanced} through</strong>
          </>
        )}
        {summary.eliminated > 0 && (
          <>
            {summary.advanced > 0 ? " · " : " "}
            <strong style={{ color: "var(--ember, #d8351c)" }}>{summary.eliminated} out</strong>
          </>
        )}
        .
      </p>

      {/* Column head */}
      <div className="std-row std-head" style={{ marginTop: 14 }}>
        <span style={{ textAlign: "right" }}>#</span>
        <span>Team</span>
        <span style={{ textAlign: "center" }}>W-L</span>
        <span style={{ textAlign: "center" }} className="std-rd">RD</span>
        <span style={{ textAlign: "right" }}>Status</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
        {rows.map((row, i) => {
          const team = row.pickid != null ? teamMap.get(row.pickid) : undefined;
          const meta = STATUS_META[row.status];
          return (
            <div
              key={`${row.pickid ?? row.name}:${i}`}
              className="std-row brk"
              style={{
                alignItems: "center",
                padding: "8px 10px",
                background: "var(--surf-1)",
                border: "1px solid var(--hair)",
              }}
            >
              {/* seed / position */}
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-low)" }}>
                {row.seed != null ? `#${row.seed}` : i + 1}
              </span>

              {/* team */}
              <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                {team ? (
                  <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={24} />
                ) : (
                  <span aria-hidden="true" style={monogramStyle}>{row.name.slice(0, 2).toUpperCase()}</span>
                )}
                <span style={{ minWidth: 0 }}>
                  <span style={teamNameStyle}>{team?.name ?? row.name}</span>
                </span>
              </span>

              {/* record */}
              <span style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--ink-hi)", whiteSpace: "nowrap" }}>
                {row.wins}-{row.losses}
              </span>

              {/* round diff */}
              <span
                className="std-rd"
                style={{
                  textAlign: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: row.roundDiff > 0 ? "var(--tac-green, #9bd23c)" : row.roundDiff < 0 ? "var(--ember, #d8351c)" : "var(--ink-low)",
                }}
              >
                {row.roundDiff > 0 ? `+${row.roundDiff}` : row.roundDiff}
              </span>

              {/* status chip */}
              <span style={{ textAlign: "right" }}>
                <span
                  style={{
                    display: "inline-block",
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: "0.1em",
                    padding: "3px 7px",
                    color: meta.color,
                    border: `1px solid ${meta.color}`,
                    borderRadius: 2,
                    opacity: row.status === "live" ? 0.7 : 1,
                  }}
                >
                  {meta.label}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Source attribution */}
      <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: "var(--ink-low)", margin: "14px 0 0" }}>
        SOURCE:{" "}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-mid)" }}>
          {source}
        </a>{" "}
        · UPDATES HOURLY
      </p>

      <style>{`
        .std-row {
          display: grid;
          grid-template-columns: 28px 1fr auto 40px 52px;
          gap: 10px;
        }
        .std-head {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--ink-low);
          padding: 0 10px;
        }
        @media (max-width: 380px) {
          .std-row { grid-template-columns: 24px 1fr auto 48px; gap: 8px; }
          .std-row .std-rd { display: none; }
        }
      `}</style>
    </div>
  );
}

const teamNameStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--ink-hi)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const monogramStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  flexShrink: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  fontWeight: 700,
  color: "var(--ink-mid)",
  background: "var(--surf-2, rgba(255,255,255,0.04))",
  border: "1px solid var(--hair)",
};
