"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { statsForPickid, TEAM_STATS_AS_OF, type TeamStats } from "@/lib/team-stats-core";

interface Props {
  team: TeamDef;
  onClose: () => void;
  /**
   * Live dossier for this team (PHA-921), with `recent[]` pulled live for the
   * current stage. Preferred over the frozen snapshot when present; undefined
   * off-window / cold start, in which case the frozen snapshot is shown.
   */
  liveStats?: TeamStats;
  /** Snapshot date of the live crawl (YYYY-MM-DD); falls back to the frozen label. */
  liveAsOf?: string;
}

/**
 * Team dossier (PHA-893) — roster, world standing, and the five most recent
 * matches. Deliberately off-board: nothing here renders on the pickems stage by
 * default; it surfaces only when a scout taps the [i] on a team. Pure-data
 * backed (team-stats-core), so it degrades to "no stats yet" for TBD slots.
 *
 * PHA-897: rendered through a body portal. PicksBoard lives inside `main.shell`,
 * which is a `z-index: 3` stacking context — so an in-tree backdrop's `z-index`
 * is trapped below it and the root-level `.botnav` (z-index 50) painted over the
 * bottom of the panel on mobile, clipping the last match + footer. Portaling to
 * <body> lifts the modal out of that context so the backdrop covers everything.
 *
 * PHA-897 follow-up (Brandon): scrollbar chrome hidden in CSS for a cleaner
 * desktop look, recent matches expanded 3 → 5, and a link out to the team's
 * HLTV profile (the dossier's data source) added beneath the match list.
 *
 * PHA-921: the "Last 5 matches" now refresh per stage on their own. The picks
 * page reads a live cache server-side and passes `liveStats` (recent[] pulled
 * live, roster/rank kept frozen) — preferred here over the committed snapshot,
 * which remains the fallback off-window / before the first crawl lands.
 */
export function TeamStatsDrawer({ team, onClose, liveStats, liveAsOf }: Props) {
  // Esc closes — modal convention; backdrop click also closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Prefer the live per-stage dossier; fall back to the committed frozen snapshot.
  const stats = liveStats ?? statsForPickid(team.pickid);
  const asOf = (liveStats && liveAsOf) || TEAM_STATS_AS_OF;

  // PHA-992 follow-up (Brandon: "where does the recent games section go now?"):
  // the per-player roster rows made the dossier ~140px taller, and the panel's
  // scrollbar chrome is hidden (PHA-897) — so on short viewports "Last 5 matches"
  // slipped below the fold with no cue it exists. Track whether more content sits
  // below the visible edge and show a fade cue (.tsd-more-below::after) while it does.
  const panelRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const update = () =>
      setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [stats]);

  // Only ever rendered client-side (opened by a tap, so absent from SSR output);
  // bail if document is somehow unavailable rather than crash createPortal.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="tsd-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${team.name} statistics and standings`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={`tsd-panel panel brk${moreBelow ? " tsd-more-below" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="br-tr" />
        <span className="br-bl" />

        <button className="tsd-close" type="button" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="tsd-head">
          <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={48} />
          <div className="tsd-head-text">
            <span className="eyebrow-mono">TEAM DOSSIER</span>
            <h3 className="tsd-name font-display">{team.name}</h3>
          </div>
          {stats?.worldRank != null && (
            <div className="tsd-rank" title={`HLTV world ranking #${stats.worldRank}`}>
              <span className="tsd-rank-num">#{stats.worldRank}</span>
              <span className="tsd-rank-lbl">WORLD</span>
            </div>
          )}
        </div>

        {!stats ? (
          <p className="tsd-empty">No stats on file for this team yet.</p>
        ) : (
          <>
            <section className="tsd-sec">
              <h4 className="tsd-sec-title">Roster</h4>
              <ul className="tsd-roster">
                {stats.roster.map((p) => (
                  <li key={p.name} className="tsd-player">
                    <a
                      className="tsd-player-name"
                      href={p.hltvUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {p.name}
                      <svg className="tsd-player-ext" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 17 17 7M9 7h8v8" />
                      </svg>
                    </a>
                    <span className={`tsd-player-pos pos-${p.position.toLowerCase()}`}>
                      {p.position}
                    </span>
                    {p.rating != null && (
                      <span className="tsd-player-rating" title="HLTV rating on this team">
                        {p.rating.toFixed(2)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="tsd-roster-key">Click a name for their HLTV profile · rating = HLTV team average</p>
            </section>

            <section className="tsd-sec">
              <h4 className="tsd-sec-title">Last 5 matches</h4>
              {stats.recent.length === 0 ? (
                <p className="tsd-empty">No recent matches on file.</p>
              ) : (
                <ul className="tsd-matches">
                  {stats.recent.map((m, i) => (
                    <li
                      key={`${m.date}-${i}`}
                      className={`tsd-match ${m.result === "W" ? "win" : m.result === "L" ? "loss" : "tie"}`}
                    >
                      <span className="tsd-res">{m.result}</span>
                      <span className="tsd-opp">vs {m.opponent}</span>
                      <span className="tsd-score">{m.score}</span>
                      <span className="tsd-date">{m.date}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {stats.hltvUrl && (
              <a
                className="tsd-link"
                href={stats.hltvUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Full profile on HLTV
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              </a>
            )}
          </>
        )}

        <p className="tsd-foot">World ranking &amp; results via HLTV · snapshot {asOf}</p>
      </div>
    </div>,
    document.body,
  );
}
