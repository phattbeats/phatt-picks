/**
 * Live Swiss bracket board (PHA-902) — the real tournament-site bracket.
 *
 * Brandon: it needs to look like the actual Swiss bracket (cs.money / HLTV), the
 * earlier column-of-cells format read as confusing. So this lays the rounds out
 * in the canonical Swiss FAN: each progression step is a column, winners drift
 * UP and losers drift DOWN, with green ↗ / red ↘ flow arrows between columns.
 * Each match is a single compact row — logoA · score–score · logoB, winner lit,
 * loser dimmed — and the teams that clinch 3-0 / 0-3 land in green ADVANCING /
 * red ELIMINATED boxes at the top / bottom of their column. Horizontal-scroll on
 * mobile (a Swiss bracket is wide by nature).
 *
 * Server component: data is parsed + cached upstream (getSwissBracket from the
 * HLTV crawl); the picks page's <AutoRefresh> re-renders it live. Truthful: every
 * score + winner is HLTV's own; an unplayed cell shows "vs" with no invented
 * result; a column with no content is omitted.
 */

import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { LastUpdated } from "@/components/LastUpdated";
import type { BracketSide, BracketTeam, SwissRound } from "@/lib/swiss-bracket-core";

// The canonical 16-team Swiss column fan, top → bottom within each column:
// advancing (3-win) boxes sit on top, eliminated (3-loss) on the bottom, the
// in-progress records in the middle — exactly the cs.money layout. A round only
// renders if it has content, so early on only the reached columns show.
const COLUMN_LAYOUT: readonly (readonly string[])[] = [
  ["0:0"],
  ["1:0", "0:1"],
  ["3:0", "2:0", "1:1", "0:2", "0:3"],
  ["3:1", "2:1", "1:2", "1:3"],
  ["3:2", "2:2", "2:3"],
];

export function LiveSwissBracketBoard({
  rounds,
  teamMap,
  source,
  sourceUrl,
  fetchedAtIso,
}: {
  rounds: SwissRound[];
  teamMap: Map<number, TeamDef>;
  source: string;
  sourceUrl: string;
  fetchedAtIso: string;
}) {
  if (rounds.length === 0) return null;
  const byLabel = new Map(rounds.map((r) => [r.label, r]));

  // Build the visible columns from the canonical layout, keeping only rounds that
  // actually have content. Any reached round not in the layout (defensive) is
  // appended as its own column so nothing is silently dropped.
  const laidOut = new Set(COLUMN_LAYOUT.flat());
  const columns: SwissRound[][] = COLUMN_LAYOUT
    .map((labels) => labels.map((l) => byLabel.get(l)).filter((r): r is SwissRound => !!r && hasContent(r)))
    .filter((col) => col.length > 0);
  for (const r of rounds) {
    if (!laidOut.has(r.label) && hasContent(r)) columns.push([r]);
  }
  if (columns.length === 0) return null;

  return (
    <div className="panel brk" style={{ padding: "20px 18px 22px" }}>
      <span className="br-tr" />
      <span className="br-bl" />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="eyebrow-mono" style={{ color: "var(--heat)" }}>
          [ LIVE BRACKET ]
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-low)" }}>
          <LastUpdated iso={fetchedAtIso} />
        </span>
      </div>

      <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "10px 0 14px", lineHeight: 1.5 }}>
        The Swiss bracket — winners climb, losers drop, round by round.{" "}
        <strong style={{ color: "var(--tac-green, #9bd23c)" }}>Through</strong> at 3 wins,{" "}
        <strong style={{ color: "var(--ember, #d8351c)" }}>out</strong> at 3 losses.
      </p>

      {/* Horizontal-scroll fan */}
      <div className="brkt-scroll">
        <div className="brkt-cols">
          {columns.map((col, ci) => (
            <div key={ci} style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
              <div className="brkt-col">
                {col.map((round) => (
                  <RoundBox key={round.label} round={round} teamMap={teamMap} />
                ))}
              </div>
              {ci < columns.length - 1 && <FlowArrows />}
            </div>
          ))}
        </div>
      </div>

      {/* Source attribution */}
      <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: "var(--ink-low)", margin: "16px 0 0" }}>
        SOURCE:{" "}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-mid)" }}>
          {source}
        </a>{" "}
        · UPDATES HOURLY
      </p>

      <style>{`
        .brkt-scroll { overflow-x: auto; overflow-y: hidden; margin: 0 -4px; padding: 0 4px 8px; -webkit-overflow-scrolling: touch; }
        .brkt-cols { display: inline-flex; gap: 0; align-items: center; min-width: min-content; }
        /* Logos as large as possible — they ARE the cell (Brandon). The TeamLogo
           renders at LOGO_SIZE; CSS scales the displayed size responsively and
           overrides next/image's width/height + the monogram's inline size. */
        .brkt-logo, .brkt-logo > * { width: var(--brkt-logo); height: var(--brkt-logo); }
        .brkt-logo img, .brkt-logo > div, .brkt-logo > span {
          width: var(--brkt-logo) !important; height: var(--brkt-logo) !important;
        }
        .brkt-col {
          --brkt-logo: 46px;
          flex: 0 0 auto; width: 196px; display: flex; flex-direction: column; justify-content: center; gap: 14px;
        }
        .brkt-box-head {
          display: flex; align-items: center; justify-content: space-between; gap: 6px;
          font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
          padding: 0 2px 6px; white-space: nowrap;
        }
        .brkt-box { border: 1px solid var(--hair); background: var(--surf-1); }
        .brkt-row { display: flex; align-items: center; gap: 8px; padding: 8px 9px; }
        .brkt-row + .brkt-row { border-top: 1px solid var(--hair); }
        .brkt-score { flex: 1; min-width: 0; text-align: center; font-family: var(--font-mono); font-weight: 700; white-space: nowrap; font-size: 15px; }
        .brkt-teamname { flex: 1; min-width: 0; font-weight: 500; color: var(--ink-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
        .brkt-flow { flex: 0 0 auto; width: 26px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; font-size: 15px; }
        /* Desktop: 2–3× the mobile size (Brandon). */
        @media (min-width: 760px) {
          .brkt-col { --brkt-logo: 72px; width: 320px; gap: 22px; }
          .brkt-box-head { font-size: 13px; padding-bottom: 9px; }
          .brkt-row { gap: 12px; padding: 12px 14px; }
          .brkt-score { font-size: 24px; }
          .brkt-teamname { font-size: 19px; }
          .brkt-flow { width: 40px; gap: 44px; font-size: 24px; }
        }
      `}</style>
    </div>
  );
}

function hasContent(r: SwissRound): boolean {
  return r.matches.length > 0 || r.teams.length > 0;
}

const ACCENT: Record<SwissRound["kind"], string> = {
  advancing: "var(--tac-green, #9bd23c)",
  eliminated: "var(--ember, #d8351c)",
  contention: "var(--ink-low)",
};
const KIND_LABEL: Record<SwissRound["kind"], string | null> = {
  advancing: "ADVANCING",
  eliminated: "ELIMINATED",
  contention: null,
};

/** One record-box in a column: a header + its matches (or settled teams). */
function RoundBox({ round, teamMap }: { round: SwissRound; teamMap: Map<number, TeamDef> }) {
  const accent = ACCENT[round.kind];
  const tag = KIND_LABEL[round.kind];
  const terminal = round.matches.length === 0;
  const bo = round.matches[0]?.bestOf ?? 0;
  return (
    <div>
      <div className="brkt-box-head">
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: tag ? accent : "var(--ink-hi)", fontWeight: 700 }}>{round.label}</span>
          {bo > 0 && <span style={{ color: "var(--ink-low)" }}>Bo{bo}</span>}
        </span>
        {tag && <span style={{ color: accent, fontWeight: 700, letterSpacing: "0.1em" }}>{tag}</span>}
      </div>
      <div className="brkt-box" style={tag ? { borderColor: accent } : undefined}>
        {terminal
          ? round.teams.map((t, i) => <TeamRow key={`${t.pickid ?? t.name}:${i}`} team={t} teamMap={teamMap} accent={accent} />)
          : round.matches.map((m, i) => <MatchRow key={m.matchId ?? i} match={m} teamMap={teamMap} />)}
      </div>
    </div>
  );
}

/** A single match as one compact row: logoA · scoreA – scoreB · logoB. */
function MatchRow({
  match,
  teamMap,
}: {
  match: SwissRound["matches"][number];
  teamMap: Map<number, TeamDef>;
}) {
  const { team1, team2, played } = match;
  return (
    <div className="brkt-row">
      <SideLogo side={team1} teamMap={teamMap} dim={played && !team1.winner} />
      <span className="brkt-score">
        {played ? (
          <>
            <span style={{ color: team1.winner ? "var(--tac-green, #9bd23c)" : "var(--ink-low)" }}>{team1.score}</span>
            <span style={{ color: "var(--ink-low)", margin: "0 3px" }}>–</span>
            <span style={{ color: team2.winner ? "var(--tac-green, #9bd23c)" : "var(--ink-low)" }}>{team2.score}</span>
          </>
        ) : (
          <span style={{ color: "var(--ink-low)", letterSpacing: "0.1em", opacity: 0.7 }}>VS</span>
        )}
      </span>
      <SideLogo side={team2} teamMap={teamMap} dim={played && !team2.winner} />
    </div>
  );
}

function SideLogo({
  side,
  teamMap,
  dim,
}: {
  side: BracketSide;
  teamMap: Map<number, TeamDef>;
  dim: boolean;
}) {
  const team = side.pickid != null ? teamMap.get(side.pickid) : undefined;
  const label = team?.name ?? side.name ?? "TBD";
  return (
    <span className="brkt-logo" title={label} style={{ flexShrink: 0, opacity: dim ? 0.4 : 1, display: "inline-flex" }}>
      {team ? (
        <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={LOGO_SIZE} />
      ) : (
        <span aria-hidden="true" style={monogramStyle}>{(side.name ?? "?").slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}

/** A settled team in a terminal (advanced / eliminated) box. */
function TeamRow({
  team,
  teamMap,
  accent,
}: {
  team: BracketTeam;
  teamMap: Map<number, TeamDef>;
  accent: string;
}) {
  const def = team.pickid != null ? teamMap.get(team.pickid) : undefined;
  return (
    <div className="brkt-row" style={{ borderLeft: `2px solid ${accent}` }}>
      <span className="brkt-logo" style={{ flexShrink: 0, display: "inline-flex" }}>
        {def ? (
          <TeamLogo tiers={resolveLogoTiers(def)} teamName={def.name} size={LOGO_SIZE} />
        ) : (
          <span aria-hidden="true" style={monogramStyle}>{team.name.slice(0, 2).toUpperCase()}</span>
        )}
      </span>
      <span className="brkt-teamname">{def?.name ?? team.name}</span>
    </div>
  );
}

/** The green ↗ (advance) / red ↘ (eliminate) flow arrows between columns. */
function FlowArrows() {
  return (
    <div className="brkt-flow" aria-hidden="true">
      <span style={{ color: "var(--tac-green, #9bd23c)", fontWeight: 800, lineHeight: 1 }}>↗</span>
      <span style={{ color: "var(--ember, #d8351c)", fontWeight: 800, lineHeight: 1 }}>↘</span>
    </div>
  );
}

// Render logos at the desktop target size; CSS scales the DISPLAYED size down on
// mobile, so they're crisp at every breakpoint.
const LOGO_SIZE = 64;

const monogramStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  borderRadius: 4,
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  fontWeight: 700,
  color: "var(--ink-mid)",
  background: "var(--surf-2, rgba(255,255,255,0.04))",
  border: "1px solid var(--hair)",
} as const;
