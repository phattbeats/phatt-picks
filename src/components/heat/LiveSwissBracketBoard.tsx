/**
 * Live Swiss bracket board (#902) — the real tournament-site bracket, Singapore
 * skin: carbon boxes, hairlines, green/red kept only as a thin status signal.
 *
 * The canonical cs.money/HLTV Swiss fan: each progression step is a column,
 * winners climb (ADVANCING boxes at the top), losers drop (ELIMINATED at the
 * bottom). Each match is a single compact row — logoA · score–score ·
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

import Link from "next/link";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { LastUpdated } from "@/components/LastUpdated";
import { teamHref } from "@/components/sg/teams/team-assets";
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
    <section className="sgb-board">
      <div className="sect-head">
        <h2 className="display sgb-h">Live bracket</h2>
        <span className="last-updated">
          <LastUpdated iso={fetchedAtIso} />
        </span>
      </div>

      <p className="sgb-copy">
        Winners climb, losers drop, round by round. <b className="ok">Through</b> at 3 wins,{" "}
        <b className="crit">out</b> at 3 losses.
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

      <p className="sgb-src">
        Source{" "}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{source}</a>{" "}
        · updates hourly
      </p>
    </section>
  );
}

const KIND_LABEL: Record<RoundKind, string | null> = {
  advancing: "Advancing",
  eliminated: "Eliminated",
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
  const tag = KIND_LABEL[kind];
  const bo = data?.matches[0]?.bestOf ?? skel.bo;

  let rows;
  if (skel.type === "team") {
    const teams = data?.teams ?? [];
    rows = Array.from({ length: skel.cells }, (_, i) =>
      teams[i] ? (
        <TeamRow key={i} team={teams[i]} teamMap={teamMap} />
      ) : (
        <BlankTeamRow key={i} />
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
    <div className={`brkt-round k-${kind}`}>
      <div className="brkt-box-head">
        <span>
          <b>{label}</b>
          {bo > 0 && <span className="bo">Bo{bo}</span>}
        </span>
        {tag && <span className="kind">{tag}</span>}
      </div>
      <div className="brkt-box">{rows}</div>
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
            <span className={team1.winner ? "w" : undefined}>{team1.score}</span>
            <span className="dash">–</span>
            <span className={team2.winner ? "w" : undefined}>{team2.score}</span>
          </>
        ) : (
          <span className="vs">VS</span>
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
      <span className="brkt-score">
        <span className="vs">VS</span>
      </span>
      <span className="brkt-logo brkt-ph" />
    </div>
  );
}

function BlankTeamRow() {
  return (
    <div className="brkt-row brkt-blank brkt-settled">
      <span className="brkt-logo brkt-ph" />
      <span className="brkt-teamname">TBD</span>
    </div>
  );
}

function SideLogo({ side, teamMap, dim }: { side: BracketSide; teamMap: Map<number, TeamDef>; dim: boolean }) {
  const team = side.pickid != null ? teamMap.get(side.pickid) : undefined;
  const label = team?.name ?? side.name ?? "TBD";
  return (
    <span className={`brkt-logo${dim ? " dim" : ""}`} title={label}>
      {team ? (
        <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={LOGO_SIZE} />
      ) : (
        <span aria-hidden="true" className="brkt-mono">{(side.name ?? "?").slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}

/** A settled team in a terminal (advanced / eliminated) box. */
function TeamRow({ team, teamMap }: { team: BracketTeam; teamMap: Map<number, TeamDef> }) {
  const def = team.pickid != null ? teamMap.get(team.pickid) : undefined;
  return (
    <div className="brkt-row brkt-settled">
      <span className="brkt-logo">
        {def ? (
          <TeamLogo tiers={resolveLogoTiers(def)} teamName={def.name} size={LOGO_SIZE} />
        ) : (
          <span aria-hidden="true" className="brkt-mono">{team.name.slice(0, 2).toUpperCase()}</span>
        )}
      </span>
      {def ? (
        <Link href={teamHref(def)} prefetch={false} className="brkt-teamname">
          {def.name}
        </Link>
      ) : (
        <span className="brkt-teamname">{team.name}</span>
      )}
    </div>
  );
}

/** Advance (up) / eliminate (down) flow marks between columns. */
function FlowArrows() {
  return (
    <div className="brkt-flow" aria-hidden="true">
      <span className="up">↗</span>
      <span className="dn">↘</span>
    </div>
  );
}

// Render logos at the desktop target size; CSS scales the displayed size down on
// mobile, so they're crisp at every breakpoint.
const LOGO_SIZE = 80;
