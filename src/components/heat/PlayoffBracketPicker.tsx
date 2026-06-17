"use client";

/**
 * Interactive playoff bracket predictor (PHA-1204).
 *
 * Brandon: "Playoffs: it is ONE stage, you place the whole bracket at once. You
 * could visualize it as the entire bracket as is, and the player drags their
 * winning team." This replaces the three stacked round-pickers with a single
 * QF → SF → GF tree you fill in one pass: tap the team you call to win a match
 * and it ADVANCES into the Semifinal (then the Final) it feeds. Re-pick an
 * upstream match and anything downstream that depended on it clears.
 *
 * The geometry mirrors the read-only LivePlayoffBracket (fixed-pixel columns
 * whose gap doubles each round, connector lines drawn from the same maths), so
 * the picker and the live bracket read as the same object — one is just live.
 *
 * Persistence: each match is one Pick row (slot 0 of its layout group), saved
 * through POST /api/picks per section. A cascade can touch more than one round,
 * so a single edit may save several groups across sections at once; on failure
 * the whole edit reverts to the last server-confirmed state.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import { SpotlightModal, type SpotlightMarketLine } from "@/components/ui/SpotlightModal";
import { LockInStage } from "@/components/LockInStage";
import { teamAccent } from "@/lib/playoff-spotlights";
import type { TeamDef } from "@/lib/layout";
import type { TeamStats } from "@/lib/team-stats-core";
import {
  resolveBracketPicks,
  type BracketPickModel,
  type BracketPickMatch,
} from "@/lib/playoff-bracket-core";

interface BracketGeo {
  mh: number; // match cell height
  g0: number; // base gap between first-round matches
  colw: number; // column width
  cw: number; // connector lane width between columns
  hh: number; // column header height
  logo: number;
  nameFs: number;
  headFs: number;
  rowPad: string;
}

const GEO_COMPACT: BracketGeo = {
  mh: 84, g0: 18, colw: 200, cw: 34, hh: 30, logo: 22, nameFs: 12, headFs: 9, rowPad: "8px 9px",
};
const GEO_DESKTOP: BracketGeo = {
  mh: 132, g0: 30, colw: 384, cw: 72, hh: 42, logo: 40, nameFs: 16, headFs: 11, rowPad: "11px 14px",
};

const HEAT = "var(--heat)";
const GREEN = "var(--tac-green, #9bd23c)";
const DND_MIME = "application/x-phatt-picks-team";

type SaveState = "saving" | "saved" | "error";

export function PlayoffBracketPicker({
  model,
  teams,
  initialPicks,
  enabled,
  eventId,
  signedIn,
  steamLinked,
  initiallySynced,
  liveTeamStats,
  liveStatsAsOf,
  spotlightMarket,
}: {
  model: BracketPickModel;
  teams: TeamDef[];
  /** groupId → the viewer's saved winner pickid (slot 0 of each match group). */
  initialPicks: Record<number, number>;
  enabled: boolean;
  eventId: number;
  signedIn: boolean;
  steamLinked: boolean;
  /** Server-derived: every saved bracket pick is already on Steam (PHA-1214). */
  initiallySynced?: boolean;
  liveTeamStats?: Record<number, TeamStats>;
  liveStatsAsOf?: string;
  spotlightMarket?: Record<number, SpotlightMarketLine>;
}) {
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.pickid, t])), [teams]);

  // `picks` is always the pruned, self-consistent set (resolveBracketPicks).
  const [picks, setPicks] = useState<Record<number, number>>(
    () => resolveBracketPicks(model, initialPicks).picks,
  );
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const [statsTeam, setStatsTeam] = useState<TeamDef | null>(null);
  const [unsavedSinceSync, setUnsavedSinceSync] = useState(false);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Section id for each match group — for persisting the right section.
  const sectionByGroup = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of model.rounds) for (const mt of r.matches) m.set(mt.groupId, mt.sectionId);
    return m;
  }, [model]);

  const resolved = useMemo(() => resolveBracketPicks(model, picks), [model, picks]);

  // Persistence is a debounced, single-flight sync (PHA-1204). A bracket edit
  // can cascade across rounds and the user can crown several matches faster than
  // a round-trip; firing one fetch per click with a shared "last saved" snapshot
  // raced and clobbered earlier picks. Instead we keep the latest desired state
  // in a ref and flush the DIFF against what the server last confirmed — one save
  // at a time, re-flushing if more changed while it was in flight. Optimistic:
  // local state is the source of truth; a failed save surfaces "retry" and the
  // next edit (or a reload) reconciles it.
  const picksRef = useRef(picks);
  const lastSaved = useRef<Record<number, number>>({ ...picks });
  const savingRef = useRef(false);

  useEffect(() => {
    picksRef.current = picks;
  }, [picks]);

  const diffGroups = (next: Record<number, number>, base: Record<number, number>) => {
    const out: number[] = [];
    for (const gId of new Set([...Object.keys(next), ...Object.keys(base)].map(Number))) {
      if ((next[gId] ?? 0) !== (base[gId] ?? 0)) out.push(gId);
    }
    return out;
  };

  const flush = useCallback(async () => {
    if (savingRef.current) return; // an in-flight save will re-check on completion
    const next = picksRef.current;
    const changed = diffGroups(next, lastSaved.current);
    if (changed.length === 0) return;

    const bySection = new Map<number, Array<{ groupId: number; slotIndex: number; pickId: number; itemId: string }>>();
    for (const gId of changed) {
      const secId = sectionByGroup.get(gId);
      if (secId == null) continue;
      const arr = bySection.get(secId) ?? [];
      arr.push({ groupId: gId, slotIndex: 0, pickId: next[gId] ?? 0, itemId: "" });
      bySection.set(secId, arr);
    }

    savingRef.current = true;
    setSaveState("saving");
    try {
      await Promise.all(
        [...bySection.entries()].map(async ([sectionId, batch]) => {
          const res = await fetch("/api/picks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventId, sectionId, picks: batch }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        }),
      );
      lastSaved.current = { ...next };
      setSaveState("saved");
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? null : s)), 1400);
    } catch {
      setSaveState("error");
    } finally {
      savingRef.current = false;
      // More edits landed while we were saving (or a retry is due)? Go again.
      if (diffGroups(picksRef.current, lastSaved.current).length > 0) void flush();
    }
  }, [eventId, sectionByGroup]);

  // Debounce: coalesce a burst of crowns into a single save of the final state.
  useEffect(() => {
    if (!enabled) return;
    if (diffGroups(picks, lastSaved.current).length === 0) return;
    setUnsavedSinceSync(true);
    const t = window.setTimeout(() => void flush(), 200);
    return () => window.clearTimeout(t);
  }, [picks, enabled, flush]);

  // Crown `teamId` the winner of `groupId`, then re-resolve so the advance
  // propagates and any now-impossible downstream pick is pruned. The save effect
  // above picks up the new state.
  const crown = useCallback(
    (groupId: number, teamId: number) => {
      if (!enabled || teamId <= 0) return;
      setPicks((prev) =>
        prev[groupId] === teamId ? prev : resolveBracketPicks(model, { ...prev, [groupId]: teamId }).picks,
      );
    },
    [enabled, model],
  );

  const champion =
    resolved.championPickid != null ? teamMap.get(resolved.championPickid) : undefined;
  const pickCount = Object.values(resolved.picks).filter((p) => p > 0).length;
  const totalMatches = model.rounds.reduce((n, r) => n + r.matches.length, 0);

  return (
    <div className="cath-nave">
      {/* Header — bracket-free overline (v3 Cathedral, PHA-1065), accent budget
          spent on the live counter, not the label. */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--ink-mid)" }}>
          Place the whole bracket
        </span>
        <span className="last-updated">
          {pickCount}/{totalMatches} called{saveState === "saving" ? " · saving…" : saveState === "saved" ? " · saved" : saveState === "error" ? " · retry" : ""}
        </span>
      </div>
      <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "10px 0 0", lineHeight: 1.5 }}>
        One stage, one bracket. Tap the team you call to win each match — they
        advance up the nave to the next round. Tap{" "}
        <span style={{ color: "var(--heat)", fontWeight: 600 }}>★ SPOTLIGHT</span> on any
        team for its story. Change your mind upstream and the rounds below re-open.
        {!steamLinked && signedIn ? " Saves as you go." : null}
      </p>

      <div className="po-tree-compact">
        <Tree model={model} resolved={resolved} teamMap={teamMap} geo={GEO_COMPACT} enabled={enabled} dragOver={dragOver} setDragOver={setDragOver} onCrown={crown} onSpotlight={setStatsTeam} />
      </div>
      <div className="po-tree-desktop">
        <Tree model={model} resolved={resolved} teamMap={teamMap} geo={GEO_DESKTOP} enabled={enabled} dragOver={dragOver} setDragOver={setDragOver} onCrown={crown} onSpotlight={setStatsTeam} />
      </div>

      {/* Your champion (PHA-1007): the floating arch outline above the card read
          goofy, so it's gone — the champion is now carried by a big, legible team
          logo instead. Clean card, logo forward. */}
      {champion && (
        <div className="cath-altar">
          <div className="cath-altar-card">
            <div className="cath-altar-lab">Your champion</div>
            <TeamLogo tiers={resolveLogoTiers(champion)} teamName={champion.name} size={72} />
            <div className="cath-altar-who">{champion.name}</div>
            <div className="cath-altar-note">Crowned at the Cathedral</div>
          </div>
        </div>
      )}

      {enabled && steamLinked && (
        <LockInStage sectionId="playoff" unsavedSinceSync={unsavedSinceSync} initiallySynced={initiallySynced} onSynced={() => setUnsavedSinceSync(false)} />
      )}

      {statsTeam && (
        <SpotlightModal
          team={statsTeam}
          onClose={() => setStatsTeam(null)}
          liveStats={liveTeamStats?.[statsTeam.pickid]}
          liveAsOf={liveStatsAsOf}
          market={spotlightMarket?.[statsTeam.pickid]}
        />
      )}

      <style>{`
        .po-scroll { overflow-x: auto; overflow-y: hidden; margin: 0 -4px; padding: 0 4px 6px; -webkit-overflow-scrolling: touch; }
        .po-colhead { font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; padding: 0 2px; }
        .po-tree-desktop { display: none; }
        @media (min-width: 1024px) { .po-tree-compact { display: none; } .po-tree-desktop { display: block; } }
      `}</style>
    </div>
  );
}

function Tree({
  model,
  resolved,
  teamMap,
  geo,
  enabled,
  dragOver,
  setDragOver,
  onCrown,
  onSpotlight,
}: {
  model: BracketPickModel;
  resolved: ReturnType<typeof resolveBracketPicks>;
  teamMap: Map<number, TeamDef>;
  geo: BracketGeo;
  enabled: boolean;
  dragOver: number | null;
  setDragOver: (g: number | null) => void;
  onCrown: (groupId: number, teamId: number) => void;
  onSpotlight: (t: TeamDef) => void;
}) {
  const { mh, g0, colw, cw, hh } = geo;
  const rounds = model.rounds;

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
      lines.push([xRight, yTop, xJunction, yTop]);
      lines.push([xRight, yBot, xJunction, yBot]);
      lines.push([xJunction, yTop, xJunction, yBot]);
      lines.push([xJunction, yMid, xNextLeft, yMid]);
    }
  }

  return (
    <div className="po-scroll" style={{ marginTop: 16 }}>
      <div style={{ width: svgW, minWidth: svgW, height: svgH, position: "relative" }}>
        {lines.length > 0 && (
          <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {lines.map(([x1, y1, x2, y2], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--hair)" strokeWidth={1.5} />
            ))}
          </svg>
        )}

        {rounds.map((round, r) => (
          <div key={round.key} style={{ position: "absolute", top: 0, left: colLeft(r), width: colw }}>
            <div className="po-colhead" style={{ height: hh, display: "flex", alignItems: "center", gap: 6, fontSize: geo.headFs }}>
              <span style={{ color: "var(--ink-hi)", fontWeight: 700 }}>{round.short}</span>
              <span style={{ color: "var(--ink-low)" }}>{round.label}</span>
            </div>
            {round.matches.map((m, i) => (
              <div key={m.groupId} style={{ position: "absolute", top: centerY(r, i) - mh / 2, left: 0, width: colw, height: mh }}>
                <PickCell
                  match={m}
                  pick={resolved.picks[m.groupId] ?? 0}
                  top={resolved.participants.get(m.groupId)?.top ?? null}
                  bottom={resolved.participants.get(m.groupId)?.bottom ?? null}
                  teamMap={teamMap}
                  geo={geo}
                  enabled={enabled}
                  over={dragOver === m.groupId}
                  setOver={(on) => setDragOver(on ? m.groupId : dragOver === m.groupId ? null : dragOver)}
                  onCrown={onCrown}
                  onSpotlight={onSpotlight}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PickCell({
  match,
  pick,
  top,
  bottom,
  teamMap,
  geo,
  enabled,
  over,
  setOver,
  onCrown,
  onSpotlight,
}: {
  match: BracketPickMatch;
  pick: number;
  top: number | null;
  bottom: number | null;
  teamMap: Map<number, TeamDef>;
  geo: BracketGeo;
  enabled: boolean;
  over: boolean;
  setOver: (on: boolean) => void;
  onCrown: (groupId: number, teamId: number) => void;
  onSpotlight: (t: TeamDef) => void;
}) {
  const decided = pick > 0;
  const onDrop = (e: React.DragEvent) => {
    if (!enabled) return;
    const raw = e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData("text/plain");
    const teamId = Number(raw);
    setOver(false);
    if (!Number.isFinite(teamId) || teamId <= 0) return;
    if (teamId !== top && teamId !== bottom) return; // only a participant can win here
    e.preventDefault();
    onCrown(match.groupId, teamId);
  };

  return (
    <div
      onDragOver={(e) => {
        if (!enabled) return;
        const types = e.dataTransfer.types;
        if (types.includes(DND_MIME) || types.includes("text/plain")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!over) setOver(true);
        }
      }}
      onDragLeave={() => over && setOver(false)}
      onDrop={onDrop}
      style={{
        height: "100%",
        background: "var(--surf-1)",
        border: `1px solid ${over ? HEAT : decided ? "var(--hair-3)" : "var(--hair-2)"}`,
        borderRadius: 11,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        boxShadow: over ? "0 0 0 1px var(--heat)" : "none",
        transition: "border-color 140ms var(--ease)",
      }}
    >
      {/* Scout only in the Quarterfinals (PHA-1204): from the SF on it's the
          same eight teams advancing, so a Scout button on every later round is
          redundant noise (Brandon). The bracket carries it once, where the field
          is first introduced. */}
      <PickSide groupId={match.groupId} teamId={top} pick={pick} teamMap={teamMap} geo={geo} enabled={enabled} scoutable={match.round === "QF"} onCrown={onCrown} onSpotlight={onSpotlight} />
      <div style={{ height: 1, background: "var(--hair)", margin: "0 8px" }} />
      <PickSide groupId={match.groupId} teamId={bottom} pick={pick} teamMap={teamMap} geo={geo} enabled={enabled} scoutable={match.round === "QF"} onCrown={onCrown} onSpotlight={onSpotlight} />
    </div>
  );
}

function PickSide({
  groupId,
  teamId,
  pick,
  teamMap,
  geo,
  enabled,
  scoutable,
  onCrown,
  onSpotlight,
}: {
  groupId: number;
  teamId: number | null;
  pick: number;
  teamMap: Map<number, TeamDef>;
  geo: BracketGeo;
  enabled: boolean;
  /** Show the Scout button (Quarterfinals only — see PickCell). */
  scoutable: boolean;
  onCrown: (groupId: number, teamId: number) => void;
  onSpotlight: (t: TeamDef) => void;
}) {
  const team = teamId != null ? teamMap.get(teamId) : undefined;
  const tbd = teamId == null;
  const isWinner = pick > 0 && teamId === pick;
  const decided = pick > 0;
  const dimmed = decided && !isWinner && !tbd;
  const pickable = enabled && !tbd;

  return (
    <div
      role={pickable ? "button" : undefined}
      tabIndex={pickable ? 0 : undefined}
      aria-pressed={pickable ? isWinner : undefined}
      aria-label={
        team
          ? `${team.name}${isWinner ? " — your pick to advance" : ""}. ${pickable ? "Tap to advance." : ""}`
          : "To be decided"
      }
      draggable={pickable}
      onDragStart={(e) => {
        if (!team) return;
        e.dataTransfer.setData(DND_MIME, String(team.pickid));
        e.dataTransfer.setData("text/plain", String(team.pickid));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => pickable && team && onCrown(groupId, team.pickid)}
      onKeyDown={(e) => {
        if (pickable && team && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onCrown(groupId, team.pickid);
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: Math.round(geo.logo * 0.4),
        padding: geo.rowPad,
        background: isWinner ? "rgba(240,163,0,0.12)" : "transparent",
        borderLeft: isWinner ? "2px solid var(--heat)" : "2px solid transparent",
        opacity: dimmed ? 0.45 : 1,
        cursor: pickable ? "pointer" : "default",
        position: "relative",
        minWidth: 0,
      }}
    >
      {team ? (
        <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={geo.logo} />
      ) : (
        <span aria-hidden="true" style={{ ...monogram, width: geo.logo, height: geo.logo, fontSize: Math.round(geo.logo * 0.45) }}>?</span>
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ ...nameStyle, fontSize: geo.nameFs, color: tbd ? "var(--ink-low)" : isWinner ? "var(--ink-hi)" : "var(--ink-mid)", fontStyle: tbd ? "italic" : "normal" }}>
          {team?.name ?? "TBD"}
        </span>
      </span>
      {/* Spotlight button — a labelled pill, not a lone star, so it reads as
          "click me" rather than decoration (Brandon, PHA-1204). Sibling tap
          target with stopPropagation so it stays usable while the whole row is
          also the crown-the-winner button. Wears the team's accent. Quarterfinals
          only — the later rounds replay the same eight teams. */}
      {team && scoutable && (
        <span
          className="po-spot"
          role="button"
          tabIndex={0}
          aria-label={`Open ${team.name} spotlight`}
          title={`${team.name} spotlight`}
          style={teamAccent(team) ? ({ "--team-accent": teamAccent(team) } as CSSProperties) : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onSpotlight(team);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onSpotlight(team);
            }
          }}
        >
          <span className="po-spot-star" aria-hidden="true">★</span>
          <span className="po-spot-label">SPOTLIGHT</span>
        </span>
      )}
      {isWinner && (
        <span aria-hidden="true" style={{ flexShrink: 0, color: GREEN, fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: Math.round(geo.nameFs * 1.05) }}>✓</span>
      )}
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

const monogram: CSSProperties = {
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
