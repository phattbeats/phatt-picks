"use client";

/**
 * Interactive playoff bracket predictor (#1204), Singapore skin (prototype 04).
 *
 * Brandon: "Playoffs: it is ONE stage, you place the whole bracket at once. You
 * could visualize it as the entire bracket as is, and the player drags their
 * winning team." A single QF → SF → GF bracket you fill in one pass: tap the
 * team you call to win a match and it ADVANCES into the Semifinal (then the
 * Final) it feeds. Re-pick an upstream match and anything downstream that
 * depended on it clears.
 *
 * Layout: a venue banner, then three columns (Quarterfinals / Semifinals /
 * Grand Final) that stack on mobile — no horizontal scroll. The picked side of
 * each match carries an inset amber bar; the other side dims. Your champion
 * sits under the Grand Final.
 *
 * Persistence: each match is one Pick row (slot 0 of its layout group), saved
 * through POST /api/picks per section. A cascade can touch more than one round,
 * so a single edit may save several groups across sections at once; on failure
 * the whole edit reverts to the last server-confirmed state.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import { SpotlightModal, type SpotlightMarketLine } from "@/components/ui/SpotlightModal";
import { LockInStage } from "@/components/LockInStage";
import { teamAccent } from "@/lib/playoff-spotlights";
import { teamHref, teamPortrait } from "@/components/sg/teams/team-assets";
import type { TeamDef } from "@/lib/layout";
import type { TeamStats } from "@/lib/team-stats-core";
import {
  resolveBracketPicks,
  type BracketPickModel,
  type BracketPickMatch,
  type PlayoffRoundKey,
} from "@/lib/playoff-bracket-core";

const DND_MIME = "application/x-phatt-picks-team";

/** Points per correct call, per round — mirrors the committed layout's
 *  points_per_pick (12 / 10 / 7). Display only; scoring reads the layout. */
const ROUND_POINTS: Record<PlayoffRoundKey, string> = {
  QF: "12 pts each",
  SF: "10 pts each",
  GF: "7 pts",
};

const ROUND_TITLE: Record<PlayoffRoundKey, string> = {
  QF: "Quarterfinals",
  SF: "Semifinals",
  GF: "Grand Final",
};

/** Venue banner copy per Major (eventId → arena + playoff dates). */
const VENUES: Record<number, { venue: string; dates: string }> = {
  26: { venue: "LANXESS Arena", dates: "18–21 Jun" },
  27: { venue: "Singapore Indoor Stadium", dates: "10–13 Dec" },
};
const DEFAULT_VENUE = VENUES[27];

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
  /** Server-derived: every saved bracket pick is already on Steam (#1214). */
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

  // Persistence is a debounced, single-flight sync (#1204). A bracket edit
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
  const venue = VENUES[eventId] ?? DEFAULT_VENUE;
  const saveLabel =
    saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Retry" : null;

  return (
    <div className="sgb">
      {/* Venue banner (04): the venue line and one statement. The arena photo
          is carried by the /picks stage header directly above, so it isn't
          repeated here. */}
      <section className="sgb-venue">
        <div className="in">
          <span className="eyebrow">
            Playoffs · <b>{venue.venue}</b> · {venue.dates}
          </span>
          <h2 className="display">{enabled ? <>Eight in.<br />Pick the one.</> : <>Your bracket.<br />Sealed.</>}</h2>
          <p>
            {enabled ? (
              <>
                Tap a team to send it through. Quarterfinals pay <b>12 each</b>, semis <b>10</b>, the
                final <b>7</b> — all locked at the first quarterfinal.
                {!steamLinked && signedIn ? " Saves as you go." : null}
              </>
            ) : (
              <>
                Picks are locked — this is the bracket you called. <b>Live results fill in below</b> as
                matches finish.
              </>
            )}
          </p>
        </div>
      </section>

      <div className="sgb-status" aria-live="polite">
        <span className="mono">
          {enabled ? (
            <>
              <b>{pickCount}</b> / {totalMatches} calls
            </>
          ) : (
            "Locked"
          )}
        </span>
        {enabled && saveLabel && (
          <span className={`sgb-save${saveState === "error" ? " err" : ""}`}>{saveLabel}</span>
        )}
      </div>

      <div className="sgb-grid">
        {model.rounds.map((round) => (
          <div key={round.key} className="sgb-rd">
            <div className="sgb-k">
              <span>{ROUND_TITLE[round.key]}</span>
              <b>{ROUND_POINTS[round.key]}</b>
            </div>
            {round.matches.map((m) => (
              <PickCell
                key={m.groupId}
                match={m}
                pick={resolved.picks[m.groupId] ?? 0}
                top={resolved.participants.get(m.groupId)?.top ?? null}
                bottom={resolved.participants.get(m.groupId)?.bottom ?? null}
                teamMap={teamMap}
                enabled={enabled}
                over={dragOver === m.groupId}
                setOver={(on) => setDragOver(on ? m.groupId : dragOver === m.groupId ? null : dragOver)}
                onCrown={crown}
                onSpotlight={setStatsTeam}
              />
            ))}
            {round.key === "GF" && <ChampionCard champion={champion} />}
          </div>
        ))}
      </div>

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
    </div>
  );
}

/** "Your champion" — the cutout on a faint radial of the team colour. */
function ChampionCard({ champion }: { champion: TeamDef | undefined }) {
  const accent = champion ? teamAccent(champion) : null;
  const portrait = champion ? teamPortrait(champion.pickid) : null;
  const style = accent ? ({ "--c": accent } as CSSProperties) : undefined;
  return (
    <div className={`sgb-champ${champion ? "" : " empty"}`} style={style}>
      {portrait ? (
        // eslint-disable-next-line @next/next/no-img-element -- static cutout
        <img src={portrait} alt="" loading="lazy" />
      ) : champion ? (
        <span className="sgb-champ-logo">
          <TeamLogo tiers={resolveLogoTiers(champion)} teamName={champion.name} size={96} />
        </span>
      ) : null}
      <span className="eyebrow">Your champion</span>
      {champion ? (
        <Link href={teamHref(champion)} prefetch={false} className="nm">
          {champion.name}
        </Link>
      ) : (
        <span className="nm">—</span>
      )}
    </div>
  );
}

function PickCell({
  match,
  pick,
  top,
  bottom,
  teamMap,
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
  enabled: boolean;
  over: boolean;
  setOver: (on: boolean) => void;
  onCrown: (groupId: number, teamId: number) => void;
  onSpotlight: (t: TeamDef) => void;
}) {
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
      className={`sgb-mt${over ? " over" : ""}`}
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
    >
      {/* Spotlight only in the Quarterfinals (#1204): from the SF on it's the
          same eight teams advancing, so the bracket carries it once, where the
          field is first introduced. */}
      <PickSide groupId={match.groupId} teamId={top} pick={pick} teamMap={teamMap} enabled={enabled} scoutable={match.round === "QF"} firstRound={match.round === "QF"} onCrown={onCrown} onSpotlight={onSpotlight} />
      <PickSide groupId={match.groupId} teamId={bottom} pick={pick} teamMap={teamMap} enabled={enabled} scoutable={match.round === "QF"} firstRound={match.round === "QF"} onCrown={onCrown} onSpotlight={onSpotlight} />
    </div>
  );
}

function PickSide({
  groupId,
  teamId,
  pick,
  teamMap,
  enabled,
  scoutable,
  firstRound,
  onCrown,
  onSpotlight,
}: {
  groupId: number;
  teamId: number | null;
  pick: number;
  teamMap: Map<number, TeamDef>;
  enabled: boolean;
  /** Show the Spotlight button (Quarterfinals only — see PickCell). */
  scoutable: boolean;
  /** QF slots are seeded by Valve; later slots are fed by your own calls. */
  firstRound: boolean;
  onCrown: (groupId: number, teamId: number) => void;
  onSpotlight: (t: TeamDef) => void;
}) {
  const team = teamId != null ? teamMap.get(teamId) : undefined;
  const tbd = teamId == null;
  const isWinner = pick > 0 && teamId === pick;
  const decided = pick > 0;
  const dimmed = decided && !isWinner && !tbd;
  const pickable = enabled && !tbd;

  if (tbd || !team) {
    return (
      <div className="sgb-sd tbd" aria-label="To be decided">
        <span className="sgb-tile" aria-hidden="true" />
        <span className="nm">{firstRound ? "TBD" : "Pick the round before"}</span>
      </div>
    );
  }

  return (
    <div
      className={`sgb-sd${isWinner ? " pk" : dimmed ? " lo" : ""}${pickable ? " can" : ""}`}
      role={pickable ? "button" : undefined}
      tabIndex={pickable ? 0 : undefined}
      aria-pressed={pickable ? isWinner : undefined}
      aria-label={`${team.name}${isWinner ? " — your pick to advance" : ""}. ${pickable ? "Tap to advance." : ""}`}
      draggable={pickable}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, String(team.pickid));
        e.dataTransfer.setData("text/plain", String(team.pickid));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => pickable && onCrown(groupId, team.pickid)}
      onKeyDown={(e) => {
        if (pickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onCrown(groupId, team.pickid);
        }
      }}
    >
      <span className="sgb-tile">
        <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={24} />
      </span>
      <span className="nm">{team.name}</span>
      {/* Spotlight — a labelled sibling tap target with stopPropagation so it
          stays usable while the whole row is also the crown-the-winner button. */}
      {scoutable && (
        <span
          className="sgb-spot"
          role="button"
          tabIndex={0}
          aria-label={`Open ${team.name} spotlight`}
          title={`${team.name} spotlight`}
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
          <span aria-hidden="true">★</span>
          <span className="lbl">Spotlight</span>
        </span>
      )}
      {isWinner && (
        <span className="sgb-tick" aria-hidden="true">
          ✓
        </span>
      )}
    </div>
  );
}
