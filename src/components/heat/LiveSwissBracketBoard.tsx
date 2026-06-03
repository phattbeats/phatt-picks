/**
 * Live Swiss bracket board (PHA-902) — the cs.money / HLTV / BLAST picture.
 *
 * Brandon: the locked Swiss stage "needs to resemble" a real tournament-site
 * bracket. So this renders the Swiss flow as round columns — 0:0 → 1:0 / 0:1 →
 * 2:0 / 1:1 / 0:2 → … — where each cell is a match: both teams with logos, the
 * map score, the winner lit and the loser dimmed, flowing into green ADVANCING
 * and red ELIMINATED branches. Horizontal-scroll on mobile (a Swiss bracket is
 * wide by nature); the viewer's picked teams are ringed.
 *
 * Server component: data is parsed + cached upstream (getSwissBracket from the
 * HLTV crawl); the picks page's <AutoRefresh> re-renders it live. Truthful: every
 * score + winner is HLTV's own; an unplayed cell shows "vs" with no invented
 * result, and a not-yet-seeded slot shows TBD.
 */

import type { CSSProperties } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { LastUpdated } from "@/components/LastUpdated";
import type { BracketSide, BracketTeam, SwissRound, BracketRoundKind } from "@/lib/swiss-bracket-core";

const KIND_META: Record<BracketRoundKind, { label: string | null; color: string }> = {
  advancing: { label: "ADVANCING", color: "var(--tac-green, #9bd23c)" },
  eliminated: { label: "ELIMINATED", color: "var(--ember, #d8351c)" },
  contention: { label: null, color: "var(--ink-low)" },
};

export function LiveSwissBracketBoard({
  rounds,
  teamMap,
  userPickedPickids,
  source,
  sourceUrl,
  fetchedAtIso,
}: {
  rounds: SwissRound[];
  teamMap: Map<number, TeamDef>;
  userPickedPickids: ReadonlySet<number>;
  source: string;
  sourceUrl: string;
  fetchedAtIso: string;
}) {
  if (rounds.length === 0) return null;

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
        The full Swiss bracket — every match, round by round. A team is{" "}
        <strong style={{ color: "var(--tac-green, #9bd23c)" }}>through</strong> at 3 wins,{" "}
        <strong style={{ color: "var(--ember, #d8351c)" }}>out</strong> at 3 losses. Your teams are ringed.
      </p>

      {/* Horizontal-scroll bracket */}
      <div className="brkt-scroll">
        <div className="brkt-cols">
          {rounds.map((round) => {
            const meta = KIND_META[round.kind];
            // Terminal columns (3:0 advanced / 0:3 eliminated) list settled teams;
            // contention columns (still playing) list their matches.
            const terminal = round.matches.length === 0;
            const bo = round.matches[0]?.bestOf ?? 0;
            return (
              <div key={round.label} className="brkt-col">
                {/* Column header: record label + Bo (matches) + advancing/eliminated tag */}
                <div className="brkt-colhead">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--ink-hi)", fontWeight: 700 }}>{round.label}</span>
                    {bo > 0 && <span style={{ color: "var(--ink-low)" }}>Bo{bo}</span>}
                  </span>
                  {meta.label && (
                    <span style={{ color: meta.color, fontWeight: 700, letterSpacing: "0.1em" }}>
                      {meta.label}
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {terminal
                    ? round.teams.map((t, i) => (
                        <div
                          key={`${round.label}:${t.pickid ?? t.name}:${i}`}
                          className="brk brkt-match"
                          style={{ borderColor: meta.color, padding: 0 }}
                        >
                          <TeamRow team={t} teamMap={teamMap} userPicked={userPickedPickids} accent={meta.color} />
                        </div>
                      ))
                    : round.matches.map((m, i) => (
                        <div
                          key={m.matchId ?? `${round.label}:${i}`}
                          className="brk brkt-match"
                          style={{ borderColor: "var(--hair)" }}
                        >
                          <SideRow side={m.team1} played={m.played} teamMap={teamMap} userPicked={userPickedPickids} />
                          <div className="brkt-divider" />
                          <SideRow side={m.team2} played={m.played} teamMap={teamMap} userPicked={userPickedPickids} />
                        </div>
                      ))}
                </div>
              </div>
            );
          })}
        </div>
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
        .brkt-scroll { overflow-x: auto; overflow-y: hidden; margin: 0 -4px; padding: 0 4px 6px; -webkit-overflow-scrolling: touch; }
        .brkt-cols { display: inline-flex; gap: 14px; align-items: flex-start; min-width: min-content; }
        .brkt-col { flex: 0 0 auto; width: 168px; }
        .brkt-colhead {
          display: flex; align-items: center; justify-content: space-between; gap: 6px;
          font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
          padding: 4px 2px 8px; white-space: nowrap;
        }
        .brkt-match { background: var(--surf-1); border: 1px solid var(--hair); padding: 2px; }
        .brkt-divider { height: 1px; background: var(--hair); margin: 1px 7px; }
      `}</style>
    </div>
  );
}

function SideRow({
  side,
  played,
  teamMap,
  userPicked,
}: {
  side: BracketSide;
  played: boolean;
  teamMap: Map<number, TeamDef>;
  userPicked: ReadonlySet<number>;
}) {
  const team = side.pickid != null ? teamMap.get(side.pickid) : undefined;
  const mine = side.pickid != null && userPicked.has(side.pickid);
  const name = team?.name ?? side.name ?? "TBD";
  const lost = played && !side.winner && side.name != null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 7px",
        background: mine ? "rgba(240,163,0,0.10)" : "transparent",
        opacity: lost ? 0.5 : 1,
        position: "relative",
      }}
    >
      {team ? (
        <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={20} />
      ) : (
        <span aria-hidden="true" style={monogramStyle}>
          {(side.name ?? "?").slice(0, 2).toUpperCase()}
        </span>
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ ...nameStyle, color: side.winner && played ? "var(--ink-hi)" : "var(--ink-mid)" }}>
          {name}
        </span>
        {mine && <span style={pickTagStyle}>Your call</span>}
      </span>
      {/* score */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          fontWeight: 700,
          color: side.winner && played ? "var(--tac-green, #9bd23c)" : played ? "var(--ink-low)" : "var(--ink-low)",
          minWidth: 16,
          textAlign: "right",
        }}
      >
        {played && side.score != null ? side.score : side.winner ? "" : "·"}
      </span>
    </div>
  );
}

/** A settled team in a terminal (advanced / eliminated) column. */
function TeamRow({
  team,
  teamMap,
  userPicked,
  accent,
}: {
  team: BracketTeam;
  teamMap: Map<number, TeamDef>;
  userPicked: ReadonlySet<number>;
  accent: string;
}) {
  const def = team.pickid != null ? teamMap.get(team.pickid) : undefined;
  const mine = team.pickid != null && userPicked.has(team.pickid);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 8px",
        background: mine ? "rgba(240,163,0,0.10)" : "transparent",
        borderLeft: `2px solid ${accent}`,
      }}
    >
      {def ? (
        <TeamLogo tiers={resolveLogoTiers(def)} teamName={def.name} size={20} />
      ) : (
        <span aria-hidden="true" style={monogramStyle}>
          {team.name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ ...nameStyle, color: "var(--ink-hi)" }}>{def?.name ?? team.name}</span>
        {mine && <span style={pickTagStyle}>Your call</span>}
      </span>
    </div>
  );
}

const nameStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const pickTagStyle: CSSProperties = {
  display: "block",
  fontFamily: "var(--font-mono)",
  fontSize: 7,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--heat)",
};

const monogramStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  flexShrink: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 8,
  fontWeight: 700,
  color: "var(--ink-mid)",
  background: "var(--surf-2, rgba(255,255,255,0.04))",
  border: "1px solid var(--hair)",
};
