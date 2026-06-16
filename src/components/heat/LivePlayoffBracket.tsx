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
// Two scales (PHA-1016): the compact tree for narrow screens, and a roughly 2×
// desktop tree where the logos get room to breathe — this is the cathedral
// design, it carries the page. CSS media query picks which one renders.
interface BracketGeo {
  mh: number; // match cell height
  g0: number; // base gap between first-round matches
  colw: number; // column width
  cw: number; // connector lane width between columns
  hh: number; // column header height
  logo: number; // team logo size
  nameFs: number; // team name font size
  scoreFs: number; // score / ✓ font size
  tagFs: number; // "Your call" tag font size
  headFs: number; // column header font size
  rowPad: string; // side-row padding
}

const GEO_COMPACT: BracketGeo = {
  mh: 70, g0: 18, colw: 188, cw: 34, hh: 30,
  logo: 20, nameFs: 12, scoreFs: 13, tagFs: 7, headFs: 9, rowPad: "6px 7px",
};

const GEO_DESKTOP: BracketGeo = {
  mh: 132, g0: 30, colw: 372, cw: 72, hh: 42,
  logo: 42, nameFs: 16, scoreFs: 17, tagFs: 9, headFs: 11, rowPad: "11px 14px",
};

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

  return (
    <div className="panel brk" style={{ padding: "20px 18px 22px" }}>
      <span className="br-tr" />
      <span className="br-bl" />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="eyebrow-mono" style={{ color: "var(--heat)" }}>
          PLAYOFFS BRACKET
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

      {/* Horizontal-scroll bracket — compact tree on narrow screens, the 2×
          cathedral tree from 1024px up. One renders at a time (CSS toggle). */}
      <div className="po-tree-compact">
        <BracketTree rounds={rounds} teamMap={teamMap} geo={GEO_COMPACT} />
      </div>
      <div className="po-tree-desktop">
        <BracketTree rounds={rounds} teamMap={teamMap} geo={GEO_DESKTOP} />
      </div>

      <style>{`
        .po-scroll { overflow-x: auto; overflow-y: hidden; margin: 0 -4px; padding: 0 4px 6px; -webkit-overflow-scrolling: touch; }
        .po-colhead { font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; padding: 0 2px; }
        .po-tree-desktop { display: none; }
        @media (min-width: 1024px) {
          .po-tree-compact { display: none; }
          .po-tree-desktop { display: block; }
        }
      `}</style>
    </div>
  );
}

function BracketTree({
  rounds,
  teamMap,
  geo,
}: {
  rounds: PlayoffBracket["rounds"];
  teamMap: Map<number, TeamDef>;
  geo: BracketGeo;
}) {
  const { mh, g0, colw, cw, hh } = geo;

  // Per-round vertical geometry.
  const unit = mh + g0;
  const gapFor = (r: number) => unit * 2 ** r - mh;
  const offsetFor = (r: number) => (unit * (2 ** r - 1)) / 2;
  const centerY = (r: number, i: number) => hh + offsetFor(r) + i * (mh + gapFor(r)) + mh / 2;

  const tallest = Math.max(
    ...rounds.map((rd, r) => offsetFor(r) + rd.matches.length * mh + (rd.matches.length - 1) * gapFor(r)),
  );
  const svgH = hh + tallest;
  const svgW = rounds.length * colw + (rounds.length - 1) * cw;
  const colLeft = (r: number) => r * (colw + cw);

  // Connector segments — only between rounds where the next has exactly half the
  // matches (a clean single-elim feed). Degrades to no lines otherwise.
  const lines: Array<[number, number, number, number]> = [];
  for (let r = 0; r < rounds.length - 1; r++) {
    const cur = rounds[r].matches.length;
    const next = rounds[r + 1].matches.length;
    if (next * 2 !== cur) continue;
    const xRight = colLeft(r) + colw;
    const xJunction = xRight + cw / 2;
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
            style={{ position: "absolute", top: 0, left: colLeft(r), width: colw }}
          >
            <div
              className="po-colhead"
              style={{ height: hh, display: "flex", alignItems: "center", gap: 6, fontSize: geo.headFs }}
            >
              <span style={{ color: "var(--ink-hi)", fontWeight: 700 }}>{round.short}</span>
              <span style={{ color: "var(--ink-low)" }}>{round.label}</span>
            </div>
            {round.matches.map((m, i) => (
              <div
                key={m.groupId}
                style={{
                  position: "absolute",
                  top: centerY(r, i) - mh / 2,
                  left: 0,
                  width: colw,
                  height: mh,
                }}
              >
                <MatchCell match={m} teamMap={teamMap} geo={geo} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchCell({
  match,
  teamMap,
  geo,
}: {
  match: PlayoffMatch;
  teamMap: Map<number, TeamDef>;
  geo: BracketGeo;
}) {
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
      <SideRow side={match.team1} played={match.decided} teamMap={teamMap} geo={geo} />
      <div style={{ height: 1, background: "var(--hair)", margin: "0 7px" }} />
      <SideRow side={match.team2} played={match.decided} teamMap={teamMap} geo={geo} />
    </div>
  );
}

function SideRow({
  side,
  played,
  teamMap,
  geo,
}: {
  side: PlayoffSide;
  played: boolean;
  teamMap: Map<number, TeamDef>;
  geo: BracketGeo;
}) {
  const team = side.pickid != null ? teamMap.get(side.pickid) : undefined;
  const tbd = side.pickid == null;
  const lost = played && !side.winner && !tbd;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: Math.round(geo.logo * 0.4),
        padding: geo.rowPad,
        background: side.userPicked ? "rgba(240,163,0,0.10)" : "transparent",
        opacity: lost ? 0.5 : 1,
        position: "relative",
      }}
    >
      {team ? (
        <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={geo.logo} />
      ) : (
        <span aria-hidden="true" style={{ ...monogramStyle, width: geo.logo, height: geo.logo, fontSize: Math.round(geo.logo * 0.45) }}>?</span>
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            ...nameStyle,
            fontSize: geo.nameFs,
            color: tbd ? "var(--ink-low)" : side.winner && played ? "var(--ink-hi)" : "var(--ink-mid)",
            fontStyle: tbd ? "italic" : "normal",
          }}
        >
          {team?.name ?? "TBD"}
        </span>
        {side.userPicked && <span style={{ ...pickTagStyle, fontSize: geo.tagFs }}>Your call</span>}
      </span>
      {/* score (only when a live overlay provided one) */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: geo.scoreFs,
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
  fontWeight: 500,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const pickTagStyle: CSSProperties = {
  display: "block",
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--heat)",
};

const monogramStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  color: "var(--ink-low)",
  background: "var(--surf-2, rgba(255,255,255,0.04))",
  border: "1px dashed var(--hair)",
};
