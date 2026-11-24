"use client";

/**
 * Swiss bracket simulator (PHA-5453). A "Simulate" switch under the live
 * bracket: off = the live board exactly as before; on = the same fan, but every
 * undecided match is clickable. Click a team to make it win; once a round is
 * fully decided the next round is drawn by Valve's Major rules (swiss-sim-core:
 * record pools, Difficulty/Buchholz, initial seed, no rematches, the round-4/5
 * priority table). Changing an earlier pick redraws everything after it.
 *
 * Real results are locked in. Numbers shown are only Valve's own VRS
 * expected-win model (vrs-odds-core) off Valve's published VRS points; nothing
 * else is estimated. Picks live in this device's localStorage only — never sent,
 * never touch saved Pick'Em picks or scoring.
 */

import { useMemo, useSyncExternalStore, useCallback, type ReactNode } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import type { LogoTier } from "@/lib/logos";
import { simulateSwiss, matchKey, teamStatus, type SimMatch, type SimResult } from "@/lib/swiss-sim-core";
import { winnerLookup, type SimStageInput } from "@/lib/swiss-sim-input";
import { vrsWinExpectation, VRS_MODEL_URL } from "@/lib/vrs-odds-core";
import { SKELETON, COLUMN_LAYOUT } from "@/lib/swiss-skeleton";

export interface SimTeamView {
  name: string;
  tiers: LogoTier[];
}

const RULEBOOK_URL =
  "https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/621b7d91b0a236044aed62a357fddc863dfaea49/major-supplemental-rulebook.md#swiss-bracket";

// ── tiny per-device stores (same pattern as PoolPhotos) ────────────────────
const listeners = new Set<() => void>();
const memory = new Map<string, string | null>();
function readKey(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeKey(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readKey(key),
    () => null,
  );
}

function parsePicks(raw: string | null): Map<string, string> {
  if (!raw) return new Map();
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj).filter(([, v]) => typeof v === "string"));
  } catch {
    return new Map();
  }
}

/** Drop picks that no longer belong to a drawn match (an earlier pick changed). */
function prune(sim: SimResult, picks: Map<string, string>): Map<string, string> {
  const live = new Set<string>();
  for (const rd of sim.rounds) for (const m of rd.matches) live.add(matchKey(rd.round, m.a, m.b));
  return new Map([...picks].filter(([k]) => live.has(k)));
}

export function SwissSimulator({
  storageKey,
  input,
  teams,
  children,
}: {
  /** e.g. "27:111" — event + section, so each stage keeps its own sim. */
  storageKey: string;
  input: SimStageInput;
  teams: Record<string, SimTeamView>;
  /** The live board, shown when Simulate is off. */
  children: ReactNode;
}) {
  const onKey = "hotline.swissSim.on";
  const picksKey = `hotline.swissSim.picks:${storageKey}`;
  const on = useStored(onKey) === "1";
  const rawPicks = useStored(picksKey);
  const picks = useMemo(() => parsePicks(rawPicks), [rawPicks]);

  const realKeys = useMemo(() => {
    const s = new Set<string>();
    for (const m of input.real) if (m.winner) s.add(matchKey(m.round, m.a, m.b));
    return s;
  }, [input.real]);

  const sim = useMemo(() => simulateSwiss(input.seeds, winnerLookup(input.real, picks)), [input, picks]);

  const savePicks = useCallback(
    (next: Map<string, string>) => {
      const pruned = prune(simulateSwiss(input.seeds, winnerLookup(input.real, next)), next);
      // Real results never live in the pick store.
      for (const k of realKeys) pruned.delete(k);
      writeKey(picksKey, pruned.size ? JSON.stringify(Object.fromEntries(pruned)) : null);
    },
    [input, picksKey, realKeys],
  );

  const pick = (round: number, m: SimMatch, winner: string) => {
    const k = matchKey(round, m.a, m.b);
    if (realKeys.has(k)) return;
    // Read the store, not the render's copy: two quick taps before a re-render
    // must both land.
    const next = parsePicks(readKey(picksKey));
    if (next.get(k) === winner) next.delete(k);
    else next.set(k, winner);
    savePicks(next);
  };

  /** Fill every remaining match with the VRS favourite, round after round. */
  const fillFavourites = () => {
    const next = parsePicks(readKey(picksKey));
    for (let guard = 0; guard < 6; guard++) {
      const s = simulateSwiss(input.seeds, winnerLookup(input.real, next));
      if (s.openRound == null) break;
      const rd = s.rounds[s.openRound - 1];
      for (const m of rd.matches) {
        if (m.winner) continue;
        const p = vrsWinExpectation(input.points[m.a], input.points[m.b]);
        if (p == null) return savePicks(next); // no sourced number → stop, never guess
        next.set(matchKey(rd.round, m.a, m.b), p >= 0.5 ? m.a : m.b);
      }
    }
    savePicks(next);
  };

  const reset = () => writeKey(picksKey, null);

  const toolbar = (
    <div className="sim-bar">
      <label className="sim-switch">
        <span className="lbl">Simulate</span>
        <button
          type="button"
          role="switch"
          aria-label="Simulate the bracket"
          aria-checked={on}
          className={`sw${on ? " on" : ""}`}
          onClick={() => writeKey(onKey, on ? null : "1")}
        >
          <span className="knob" aria-hidden="true" />
        </button>
      </label>
      {on && (
        <span className="sim-actions">
          <button type="button" className="sim-btn" onClick={fillFavourites}>
            Fill VRS favourites
          </button>
          <button type="button" className="sim-btn" onClick={reset} disabled={picks.size === 0}>
            Reset
          </button>
        </span>
      )}
    </div>
  );

  if (!on) {
    return (
      <>
        {children}
        {toolbar}
      </>
    );
  }

  return (
    <>
      <SimBoard sim={sim} input={input} teams={teams} realKeys={realKeys} onPick={pick} />
      {toolbar}
    </>
  );
}

function SimBoard({
  sim,
  input,
  teams,
  realKeys,
  onPick,
}: {
  sim: SimResult;
  input: SimStageInput;
  teams: Record<string, SimTeamView>;
  realKeys: Set<string>;
  onPick: (round: number, m: SimMatch, winner: string) => void;
}) {
  // Group drawn matches under their W:L box, and settled teams under 3:x / x:3.
  const byLabel = new Map<string, { round: number; m: SimMatch }[]>();
  for (const rd of sim.rounds)
    for (const m of rd.matches) {
      if (!byLabel.has(m.record)) byLabel.set(m.record, []);
      byLabel.get(m.record)!.push({ round: rd.round, m });
    }
  const settled = new Map<string, string[]>();
  const ordered = [...sim.teams.values()].sort((x, y) => x.seed - y.seed);
  for (const t of ordered) {
    if (teamStatus(t) === "alive") continue;
    const label = `${t.wins}:${t.losses}`;
    if (!settled.has(label)) settled.set(label, []);
    settled.get(label)!.push(t.id);
  }
  const through = ordered.filter((t) => teamStatus(t) === "advanced").length;
  const out = ordered.filter((t) => teamStatus(t) === "eliminated").length;
  const open = sim.openRound != null ? sim.rounds[sim.openRound - 1] : null;
  const left = open ? open.matches.filter((m) => !m.winner).length : 0;

  return (
    <section className="sgb-board sim-on">
      <div className="sect-head">
        <h2 className="display sgb-h">Bracket simulator</h2>
        <span className="last-updated">Only on this device</span>
      </div>
      <p className="sgb-copy">
        Tap a team to make it win. {open ? (
          <>
            Pick the <b>{left}</b> open {left === 1 ? "match" : "matches"} in round {open.round} to draw round{" "}
            {open.round + 1}.
          </>
        ) : (
          <>Stage decided.</>
        )}{" "}
        <b className="ok">{through} through</b> · <b className="crit">{out} out</b>. Real results are locked in.
      </p>

      <div className="brkt-scroll">
        <div className="brkt-cols">
          {COLUMN_LAYOUT.map((labels, ci) => (
            <div key={ci} className="brkt-colwrap">
              <div className="brkt-col">
                {labels.map((label) => {
                  const skel = SKELETON[label];
                  const rows =
                    skel.type === "team"
                      ? Array.from({ length: skel.cells }, (_, i) => {
                          const id = settled.get(label)?.[i];
                          return id ? <SettledRow key={i} team={teams[id]} /> : <BlankTeamRow key={i} />;
                        })
                      : (() => {
                          const ms = byLabel.get(label) ?? [];
                          if (ms.length === 0)
                            return Array.from({ length: skel.cells }, (_, i) => <BlankMatchRow key={i} />);
                          return ms.map(({ round, m }) => (
                            <SimMatchRow
                              key={`${m.a}-${m.b}`}
                              m={m}
                              teams={teams}
                              locked={realKeys.has(matchKey(round, m.a, m.b))}
                              p={vrsWinExpectation(input.points[m.a], input.points[m.b])}
                              onPick={(w) => onPick(round, m, w)}
                            />
                          ));
                        })();
                  const bo = skel.type === "match" ? (byLabel.get(label)?.[0]?.m.bestOf ?? skel.bo) : 0;
                  return (
                    <div key={label} className={`brkt-round k-${skel.kind}`}>
                      <div className="brkt-box-head">
                        <span>
                          <b>{label}</b>
                          {bo > 0 && <span className="bo">Bo{bo}</span>}
                        </span>
                        {skel.kind === "advancing" && <span className="kind">Advancing</span>}
                        {skel.kind === "eliminated" && <span className="kind">Eliminated</span>}
                      </div>
                      <div className="brkt-box">{rows}</div>
                    </div>
                  );
                })}
              </div>
              {ci < COLUMN_LAYOUT.length - 1 && (
                <div className="brkt-flow" aria-hidden="true">
                  <span className="up">↗</span>
                  <span className="dn">↘</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="sgb-src sim-src">
        Pairings: <a href={RULEBOOK_URL} target="_blank" rel="noopener noreferrer">Valve Major rulebook</a> (record,
        Difficulty/Buchholz, seed, no rematches). Seeds:{" "}
        <a href={input.seedSource.url} target="_blank" rel="noopener noreferrer">{input.seedSource.label}</a>. % ={" "}
        <a href={VRS_MODEL_URL} target="_blank" rel="noopener noreferrer">Valve&apos;s VRS win model</a>. Your sim never
        changes your saved picks.
      </p>
    </section>
  );
}

function SimMatchRow({
  m,
  teams,
  locked,
  p,
  onPick,
}: {
  m: SimMatch;
  teams: Record<string, SimTeamView>;
  locked: boolean;
  p: number | null;
  onPick: (winner: string) => void;
}) {
  const decided = m.winner != null;
  const pa = p == null ? null : Math.round(p * 100);
  return (
    <div className={`brkt-row sim-row${locked ? " sim-locked" : ""}`}>
      <SimSide id={m.a} team={teams[m.a]} won={m.winner === m.a} dim={decided && m.winner !== m.a} locked={locked} onPick={onPick} />
      <span className="brkt-score sim-mid">
        {locked ? (
          <span className="sim-real">Final</span>
        ) : pa != null ? (
          <span className="sim-pct" title={`Valve VRS model: ${teams[m.a]?.name} ${pa}%, ${teams[m.b]?.name} ${100 - pa}%`}>
            <span className={m.winner === m.a ? "w" : undefined}>{pa}</span>
            <span className="dash">·</span>
            <span className={m.winner === m.b ? "w" : undefined}>{100 - pa}</span>
            <span className="sim-pct-u">% VRS</span>
          </span>
        ) : (
          <span className="vs">VS</span>
        )}
      </span>
      <SimSide id={m.b} team={teams[m.b]} won={m.winner === m.b} dim={decided && m.winner !== m.b} locked={locked} onPick={onPick} />
    </div>
  );
}

function SimSide({
  id,
  team,
  won,
  dim,
  locked,
  onPick,
}: {
  id: string;
  team: SimTeamView | undefined;
  won: boolean;
  dim: boolean;
  locked: boolean;
  onPick: (winner: string) => void;
}) {
  const name = team?.name ?? "TBD";
  const logo = team ? (
    <TeamLogo tiers={team.tiers} teamName={team.name} size={80} />
  ) : (
    <span aria-hidden="true" className="brkt-mono">?</span>
  );
  if (locked) {
    return (
      <span className={`brkt-logo${dim ? " dim" : ""}`} title={name}>
        {logo}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`brkt-logo sim-pick${dim ? " dim" : ""}${won ? " won" : ""}`}
      title={`${name} wins`}
      aria-label={`${name} wins`}
      aria-pressed={won}
      onClick={() => onPick(id)}
    >
      {logo}
    </button>
  );
}

function SettledRow({ team }: { team: SimTeamView | undefined }) {
  return (
    <div className="brkt-row brkt-settled">
      <span className="brkt-logo">
        {team ? <TeamLogo tiers={team.tiers} teamName={team.name} size={80} /> : <span className="brkt-mono">?</span>}
      </span>
      <span className="brkt-teamname">{team?.name ?? "TBD"}</span>
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
