/**
 * Live playoffs bracket (PHA-903) — the single-elim QF → SF → GF tree.
 *
 * Companion to the Swiss bracket board (PHA-902). Brandon's reference is a real
 * tournament-site playoff tree: Quarterfinals feeding Semifinals feeding the
 * Grand Final, connector lines and all, team logos + scores, winners advancing —
 * and `???` everywhere until the bracket seeds. This renders exactly that from
 * the bracket built upstream (buildPlayoffBracket): the structure comes from our
 * committed layout, the seeded teams + results fill in live as Stage 3 resolves.
 *
 * Server component: data is built upstream and the picks page's <AutoRefresh>
 * re-renders it, so it tracks seeding + results without a reload. Truthful empty
 * state — an unseeded slot is TBD, a winner lights only once a real outcome
 * resolved it, no series score is invented.
 *
 * Layout note: the columns use a fixed pixel geometry (match height + a gap that
 * doubles each round) so each round's matches sit centered against the pair that
 * feeds them; the connector lines are drawn as one SVG overlay computed from that
 * same geometry. The whole tree horizontal-scrolls on narrow screens (a bracket
 * is wide by nature) — same pattern as the Swiss board.
 */

import type { CSSProperties } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { LastUpdated } from "@/components/LastUpdated";
import {
  summarizePlayoffPicks,
  type PlayoffBracket,
  type PlayoffMatch,
  type PlayoffSide,
} from "@/lib/playoff-bracket-core";

// Fixed bracket geometry (px). The gap doubles each round so the SF sits centered
// against its QF pair and the GF against its SF pair (see playoff-bracket-core).
const MH = 70; // match cell height
const G0 = 18; // base gap between first-round matches
const COLW = 188; // column width
const CW = 34; // connector lane width between columns
const HH = 30; // column header height

const GREEN = "var(--tac-green, #9bd23c)";

export function LivePlayoffBracket({
  bracket,
  teamMap,
  signedIn,
  resolvedAtIso,
}: {
  bracket: PlayoffBracket;
  teamMap: Map<number, TeamDef>;
  signedIn: boolean;
  resolvedAtIso: string | null;
}) {
  const { rounds } = bracket;
  if (rounds.length === 0) return null;

  const summary = summarizePlayoffPicks(bracket);
  const champ = bracket.championPickid != null ? teamMap.get(bracket.championPickid) : undefined;

  // Per-round vertical geometry.
  const unit = MH + G0;
  const gapFor = (r: number) => unit * 2 ** r - MH;
  const offsetFor = (r: number) => (unit * (2 ** r - 1)) / 2;
  const centerY = (r: number, i: number) => HH + offsetFor(r) + i * (MH + gapFor(r)) + MH / 2;

  const tallest = Math.max(
    ...rounds.map((rd, r) => offsetFor(r) + rd.matches.length * MH + (rd.matches.length - 1) * gapFor(r)),
  );
  const svgH = HH + tallest;
  const svgW = rounds.length * COLW + (rounds.length - 1) * CW;
  const colLeft = (r: number) => r * (COLW + CW);

  // Connector segments — only between rounds where the next has exactly half the
  // matches (a clean single-elim feed). Degrades to no lines otherwise.
  const lines: Array<[number, number, number, number]> = [];
  for (let r = 0; r < rounds.length - 1; r++) {
    const cur = rounds[r].matches.length;
    const next = rounds[r + 1].matches.length;
    if (next * 2 !== cur) continue;
    const xRight = colLeft(r) + COLW;
    const xJunction = xRight + CW / 2;
    const xNextLeft = colLeft(r + 1);
    for (let j = 0; j < next; j++) {
      const yTop = centerY(r, 2 * j);
      const yBot = centerY(r, 2 * j + 1);
      const yMid = centerY(r + 1, j);
      lines.push([xRight, yTop, xJunction, yTop]); // stub from top match
      lines.push([xRight, yBot, xJunction, yBot]); // stub from bottom match
      lines.push([xJunction, yTop, xJunction, yBot]); // vertical join
      lines.push([xJunction, yMid, xNextLeft, yMid]); // into next match
    }
  }

  return (
    <div className="panel brk" style={{ padding: "20px 18px 22px" }}>
      <span className="br-tr" />
      <span className="br-bl" />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="eyebrow-mono" style={{ color: "var(--heat)" }}>
          [ PLAYOFFS BRACKET ]
        </span>
        <span className="last-updated">
          {bracket.anyDecided && resolvedAtIso ? <LastUpdated iso={resolvedAtIso} /> : "Updates as matches finish"}
        </span>
      </div>

      <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "10px 0 0", lineHeight: 1.5 }}>
        {bracket.anySeeded ? (
          <>Single elimination — quarters to the Grand Final. Your calls are ringed.</>
        ) : (
          <>
            The bracket seeds as Stage&nbsp;3 resolves. Until then every slot is{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-low)" }}>???</span>.
          </>
        )}
      </p>

      {/* Champion banner */}
      {champ && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "14px 0 0",
            padding: "10px 12px",
            background: "rgba(240,163,0,0.10)",
            border: "1px solid var(--hair-3)",
          }}
        >
          <TeamLogo tiers={resolveLogoTiers(champ)} teamName={champ.name} size={26} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--heat)" }}>
              Champion
            </span>
            <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--ink-hi)" }}>{champ.name}</span>
          </span>
        </div>
      )}

      {/* Viewer's call summary */}
      {signedIn && summary.picks > 0 && (
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "12px 0 0", lineHeight: 1.5 }}>
          {summary.hits + summary.misses > 0 ? (
            <>
              <strong style={{ color: "var(--ink-hi)" }}>{summary.hits}</strong> of your{" "}
              <strong style={{ color: "var(--ink-hi)" }}>{summary.picks}</strong> bracket calls have hit
              {summary.pending > 0 ? ` · ${summary.pending} still in play` : ""}.
            </>
          ) : (
            <>
              Your <strong style={{ color: "var(--ink-hi)" }}>{summary.picks}</strong> bracket calls are locked.
              Results land here as matches finish.
            </>
          )}
        </p>
      )}

      {/* Horizontal-scroll bracket */}
      <div className="po-scroll" style={{ marginTop: 16 }}>
        <div className="po-stage" style={{ width: svgW, minWidth: svgW, height: svgH, position: "relative" }}>
          {/* Connector overlay */}
          {lines.length > 0 && (
            <svg
              width={svgW}
              height={svgH}
              viewBox={`0 0 ${svgW} ${svgH}`}
              aria-hidden="true"
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            >
              {lines.map(([x1, y1, x2, y2], i) => (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--hair)" strokeWidth={1.5} />
              ))}
            </svg>
          )}

          {/* Round columns */}
          {rounds.map((round, r) => (
            <div
              key={round.key}
              style={{ position: "absolute", top: 0, left: colLeft(r), width: COLW }}
            >
              <div
                className="po-colhead"
                style={{ height: HH, display: "flex", alignItems: "center", gap: 6 }}
              >
                <span style={{ color: "var(--ink-hi)", fontWeight: 700 }}>{round.short}</span>
                <span style={{ color: "var(--ink-low)" }}>{round.label}</span>
              </div>
              {round.matches.map((m, i) => (
                <div
                  key={m.groupId}
                  style={{
                    position: "absolute",
                    top: centerY(r, i) - MH / 2,
                    left: 0,
                    width: COLW,
                    height: MH,
                  }}
                >
                  <MatchCell match={m} teamMap={teamMap} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .po-scroll { overflow-x: auto; overflow-y: hidden; margin: 0 -4px; padding: 0 4px 6px; -webkit-overflow-scrolling: touch; }
        .po-colhead { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; padding: 0 2px; }
      `}</style>
    </div>
  );
}

function MatchCell({ match, teamMap }: { match: PlayoffMatch; teamMap: Map<number, TeamDef> }) {
  // A decided match gets its winner's branch tinted; an open/seeded one is neutral.
  const accent = match.decided ? "var(--hair-3)" : "var(--hair)";
  return (
    <div
      className="brk"
      style={{
        height: "100%",
        background: "var(--surf-1)",
        border: `1px solid ${accent}`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <SideRow side={match.team1} played={match.decided} teamMap={teamMap} />
      <div style={{ height: 1, background: "var(--hair)", margin: "0 7px" }} />
      <SideRow side={match.team2} played={match.decided} teamMap={teamMap} />
    </div>
  );
}

function SideRow({
  side,
  played,
  teamMap,
}: {
  side: PlayoffSide;
  played: boolean;
  teamMap: Map<number, TeamDef>;
}) {
  const team = side.pickid != null ? teamMap.get(side.pickid) : undefined;
  const tbd = side.pickid == null;
  const lost = played && !side.winner && !tbd;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 7px",
        background: side.userPicked ? "rgba(240,163,0,0.10)" : "transparent",
        opacity: lost ? 0.5 : 1,
        position: "relative",
      }}
    >
      {team ? (
        <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={20} />
      ) : (
        <span aria-hidden="true" style={monogramStyle}>?</span>
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            ...nameStyle,
            color: tbd ? "var(--ink-low)" : side.winner && played ? "var(--ink-hi)" : "var(--ink-mid)",
            fontStyle: tbd ? "italic" : "normal",
          }}
        >
          {team?.name ?? "TBD"}
        </span>
        {side.userPicked && <span style={pickTagStyle}>Your call</span>}
      </span>
      {/* score (only when a live overlay provided one) */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          fontWeight: 700,
          color: side.winner && played ? GREEN : "var(--ink-low)",
          minWidth: 14,
          textAlign: "right",
        }}
      >
        {side.score != null ? side.score : side.winner && played ? "✓" : ""}
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
  fontSize: 9,
  fontWeight: 700,
  color: "var(--ink-low)",
  background: "var(--surf-2, rgba(255,255,255,0.04))",
  border: "1px dashed var(--hair)",
};
