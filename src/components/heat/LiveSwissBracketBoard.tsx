/**
 * Live Swiss bracket board (PHA-902) — the real tournament-site bracket.
 *
 * The canonical cs.money/HLTV Swiss fan: each progression step is a column,
 * winners climb (green ADVANCING boxes at the top), losers drop (red ELIMINATED
 * at the bottom). Each match is a single compact row — logoA · score–score ·
 * logoB, winner lit, loser dimmed. The WHOLE skeleton is always drawn (Brandon:
 * "add the missing stages, just leave them blank, so the user knows what to
 * expect; add the advancing/eliminated boxes too") — rounds not yet reached show
 * placeholder "VS" matches / "?" team slots. Columns are top-aligned so the
 * spacing stays uniform as it scales up on desktop. Horizontal-scroll.
 *
 * Server component: data is parsed + cached upstream (getSwissBracket from the
 * HLTV crawl); the picks page's <AutoRefresh> re-renders it live. Truthful: every
 * score + winner is HLTV's own; unreached cells are blank, never invented.
 */

import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { LastUpdated } from "@/components/LastUpdated";
import type { BracketSide, BracketTeam, SwissRound } from "@/lib/swiss-bracket-core";

type RoundKind = SwissRound["kind"];

/**
 * The full 16-team Swiss skeleton: every round's column position, kind, cell
 * count and best-of. Columns left→right; within a column, advancing (3-win) box
 * on top, eliminated (3-loss) on the bottom, in-progress between. Drawn in full
 * even before a round is reached, so the bracket reads as a complete structure.
 */
interface RoundSkel {
  kind: RoundKind;
  /** "match" rows (two teams + score) or settled "team" rows (advanced/eliminated). */
  type: "match" | "team";
  /** How many cells the round holds when full. */
  cells: number;
  /** Best-of for match rounds (0 for terminal team boxes). */
  bo: number;
}
const SKELETON: Record<string, RoundSkel> = {
  "0:0": { kind: "contention", type: "match", cells: 8, bo: 1 },
  "1:0": { kind: "contention", type: "match", cells: 4, bo: 1 },
  "0:1": { kind: "contention", type: "match", cells: 4, bo: 1 },
  "3:0": { kind: "advancing", type: "team", cells: 2, bo: 0 },
  "2:0": { kind: "contention", type: "match", cells: 2, bo: 3 },
  "1:1": { kind: "contention", type: "match", cells: 4, bo: 1 },
  "0:2": { kind: "contention", type: "match", cells: 2, bo: 3 },
  "0:3": { kind: "eliminated", type: "team", cells: 2, bo: 0 },
  "3:1": { kind: "advancing", type: "team", cells: 3, bo: 0 },
  "2:1": { kind: "contention", type: "match", cells: 3, bo: 3 },
  "1:2": { kind: "contention", type: "match", cells: 3, bo: 3 },
  "1:3": { kind: "eliminated", type: "team", cells: 3, bo: 0 },
  "3:2": { kind: "advancing", type: "team", cells: 3, bo: 0 },
  "2:2": { kind: "contention", type: "match", cells: 3, bo: 3 },
  "2:3": { kind: "eliminated", type: "team", cells: 3, bo: 0 },
};
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

  return (
    <div className="panel brk" style={{ padding: "20px 18px 22px" }}>
      <span className="br-tr" />
      <span className="br-bl" />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="eyebrow-mono" style={{ color: "var(--heat)" }}>[ LIVE BRACKET ]</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-low)" }}>
          <LastUpdated iso={fetchedAtIso} />
        </span>
      </div>

      <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "10px 0 14px", lineHeight: 1.5 }}>
        The Swiss bracket — winners climb, losers drop, round by round.{" "}
        <strong style={{ color: "var(--tac-green, #9bd23c)" }}>Through</strong> at 3 wins,{" "}
        <strong style={{ color: "var(--ember, #d8351c)" }}>out</strong> at 3 losses.
      </p>

      <div className="brkt-scroll">
        <div className="brkt-cols">
          {COLUMN_LAYOUT.map((labels, ci) => (
            <div key={ci} className="brkt-colwrap">
              <div className="brkt-col">
                {labels.map((label) => (
                  <RoundBox key={label} label={label} data={byLabel.get(label)} teamMap={teamMap} />
                ))}
              </div>
              {ci < COLUMN_LAYOUT.length - 1 && <FlowArrows />}
            </div>
          ))}
        </div>
      </div>

      <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: "var(--ink-low)", margin: "16px 0 0" }}>
        SOURCE:{" "}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-mid)" }}>{source}</a>{" "}
        · UPDATES HOURLY
      </p>

      <style>{`
        .brkt-scroll { overflow-x: auto; overflow-y: hidden; margin: 0 -4px; padding: 0 4px 8px; -webkit-overflow-scrolling: touch; }
        /* Top-align the columns so spacing stays uniform as the bracket scales
           (Brandon: widescreen was goofy). The fan comes from box ORDER — the
           advancing box leads each column, the eliminated box trails it. */
        .brkt-cols { display: inline-flex; gap: 0; align-items: flex-start; min-width: min-content; }
        .brkt-colwrap { display: flex; align-items: stretch; gap: 0; }
        .brkt-col { --brkt-logo: 50px; flex: 0 0 auto; width: 188px; display: flex; flex-direction: column; gap: 16px; }
        /* Logo sizing: render at LOGO_SIZE, CSS scales the displayed size + the
           monogram/placeholder, overriding next/image's width/height. */
        .brkt-logo, .brkt-logo > * { width: var(--brkt-logo); height: var(--brkt-logo); }
        .brkt-logo img, .brkt-logo > div, .brkt-logo > span { width: var(--brkt-logo) !important; height: var(--brkt-logo) !important; }
        .brkt-box-head {
          display: flex; align-items: center; justify-content: space-between; gap: 6px;
          font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
          padding: 0 2px 5px; white-space: nowrap;
        }
        .brkt-box { border: 1px solid var(--hair); background: var(--surf-1); }
        .brkt-row { display: flex; align-items: center; gap: 6px; padding: 5px 7px; }
        .brkt-row + .brkt-row { border-top: 1px solid var(--hair); }
        .brkt-blank { opacity: 0.45; }
        .brkt-score { flex: 1; min-width: 0; text-align: center; font-family: var(--font-mono); font-weight: 700; white-space: nowrap; font-size: 15px; }
        .brkt-teamname { flex: 1; min-width: 0; font-weight: 500; color: var(--ink-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
        .brkt-flow { flex: 0 0 auto; width: 20px; align-self: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; font-size: 14px; }
        .brkt-ph { border-radius: 50%; background: var(--surf-2, rgba(255,255,255,0.05)); border: 1px solid var(--hair); flex-shrink: 0; }
        /* Desktop: scale up uniformly. */
        @media (min-width: 760px) {
          .brkt-col { --brkt-logo: 80px; width: 320px; gap: 22px; }
          .brkt-box-head { font-size: 13px; padding-bottom: 8px; }
          .brkt-row { gap: 9px; padding: 8px 11px; }
          .brkt-score { font-size: 26px; }
          .brkt-teamname { font-size: 18px; }
          .brkt-flow { width: 34px; gap: 36px; font-size: 26px; }
        }
      `}</style>
    </div>
  );
}

const ACCENT: Record<RoundKind, string> = {
  advancing: "var(--tac-green, #9bd23c)",
  eliminated: "var(--ember, #d8351c)",
  contention: "var(--ink-low)",
};
const KIND_LABEL: Record<RoundKind, string | null> = {
  advancing: "ADVANCING",
  eliminated: "ELIMINATED",
  contention: null,
};

/** One record-box in a column — real matches/teams, or the blank skeleton. */
function RoundBox({
  label,
  data,
  teamMap,
}: {
  label: string;
  data: SwissRound | undefined;
  teamMap: Map<number, TeamDef>;
}) {
  const skel = SKELETON[label] ?? { kind: "contention" as RoundKind, type: "match" as const, cells: 1, bo: 0 };
  const kind = data?.kind ?? skel.kind;
  const accent = ACCENT[kind];
  const tag = KIND_LABEL[kind];
  const bo = data?.matches[0]?.bestOf ?? skel.bo;

  let rows;
  if (skel.type === "team") {
    const teams = data?.teams ?? [];
    rows = Array.from({ length: skel.cells }, (_, i) =>
      teams[i] ? (
        <TeamRow key={i} team={teams[i]} teamMap={teamMap} accent={accent} />
      ) : (
        <BlankTeamRow key={i} accent={accent} />
      ),
    );
  } else {
    const matches = data?.matches ?? [];
    rows =
      matches.length > 0
        ? matches.map((m, i) => <MatchRow key={m.matchId ?? i} match={m} teamMap={teamMap} />)
        : Array.from({ length: skel.cells }, (_, i) => <BlankMatchRow key={i} />);
  }

  return (
    <div>
      <div className="brkt-box-head">
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: tag ? accent : "var(--ink-hi)", fontWeight: 700 }}>{label}</span>
          {bo > 0 && <span style={{ color: "var(--ink-low)" }}>Bo{bo}</span>}
        </span>
        {tag && <span style={{ color: accent, fontWeight: 700, letterSpacing: "0.08em" }}>{tag}</span>}
      </div>
      <div className="brkt-box" style={tag ? { borderColor: accent } : undefined}>{rows}</div>
    </div>
  );
}

/** A single match: logoA · scoreA – scoreB · logoB. */
function MatchRow({ match, teamMap }: { match: SwissRound["matches"][number]; teamMap: Map<number, TeamDef> }) {
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

function BlankMatchRow() {
  return (
    <div className="brkt-row brkt-blank">
      <span className="brkt-logo brkt-ph" />
      <span className="brkt-score" style={{ color: "var(--ink-low)", fontSize: 11, letterSpacing: "0.1em" }}>VS</span>
      <span className="brkt-logo brkt-ph" />
    </div>
  );
}

function BlankTeamRow({ accent }: { accent: string }) {
  return (
    <div className="brkt-row brkt-blank" style={{ borderLeft: `2px solid ${accent}` }}>
      <span className="brkt-logo brkt-ph" />
      <span className="brkt-teamname" style={{ color: "var(--ink-low)" }}>?</span>
    </div>
  );
}

function SideLogo({ side, teamMap, dim }: { side: BracketSide; teamMap: Map<number, TeamDef>; dim: boolean }) {
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
function TeamRow({ team, teamMap, accent }: { team: BracketTeam; teamMap: Map<number, TeamDef>; accent: string }) {
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

// Render logos at the desktop target size; CSS scales the displayed size down on
// mobile, so they're crisp at every breakpoint.
const LOGO_SIZE = 80;

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
