"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { statsForPickid, TEAM_STATS_AS_OF, type TeamStats } from "@/lib/team-stats-core";
import {
  spotlightForPickid,
  teamAccent,
  youtubeEmbedUrl,
  youtubePoster,
} from "@/lib/playoff-spotlights";

/** A live market line for the team's next/active playoff matchup (1h refresh). */
export interface SpotlightMarketLine {
  /** This team's name (echoed for clarity). */
  teamName: string;
  /** This team's implied win probability, 0-100. */
  teamPct: number;
  /** The opponent's display name, or "TBD". */
  oppName: string;
  /** Opponent implied win probability, 0-100. */
  oppPct: number;
  /** Where the line came from, e.g. "Bookmaker consensus via HLTV". */
  sourceLabel: string;
  /** When it was last refreshed (already-formatted, e.g. "1h ago"). */
  updatedLabel: string;
  /** Deep link to the HLTV match page for people who want to dive in. */
  hltvMatchUrl?: string;
}

interface Props {
  team: TeamDef;
  onClose: () => void;
  /** Live per-stage dossier (PHA-921); preferred over the frozen snapshot. */
  liveStats?: TeamStats;
  liveAsOf?: string;
  /** Live market line for this team's matchup; omitted until wired (PHA-1043 follow-up). */
  market?: SpotlightMarketLine;
}

/**
 * Spotlight (PHA-1043), the playoff-grade replacement for the [i] dossier. Once
 * the field narrows to eight, a team is a narrative, not a stat line: who they
 * were before Cologne, what this run made them, an event highlight, and a live
 * market line, with the roster/last-5 "tape" kept one scroll below for the
 * scouts. Falls back gracefully to tape-only when no narrative is authored yet
 * (TBD slots, un-seeded bracket).
 *
 * Built on the same body-portal bottom-sheet pattern as TeamStatsDrawer so it
 * clears the z-index:3 `main.shell` stacking context and the botnav.
 */
export function SpotlightModal({ team, onClose, liveStats, liveAsOf, market }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const spot = spotlightForPickid(team.pickid);
  const stats = liveStats ?? statsForPickid(team.pickid);
  const asOf = (liveStats && liveAsOf) || TEAM_STATS_AS_OF;

  // Each spotlight wears the team's own color (PHA-1043 follow-up). The whole
  // panel keys off `--team-accent`; unset → the .spot CSS falls back to --heat.
  const accent = teamAccent(team);
  const accentStyle = accent
    ? ({ "--team-accent": accent } as CSSProperties)
    : undefined;

  // Highlight is tap-to-play: poster first (keeps the modal light on mobile),
  // iframe only mounts on tap, full-match ESL reels are heavy otherwise.
  const [playing, setPlaying] = useState(false);
  const highlight = spot?.highlight;
  const embedUrl = highlight ? youtubeEmbedUrl(highlight) : null;
  const poster = highlight ? youtubePoster(highlight) : null;

  // Fade cue when more content sits below the fold (mirrors the dossier).
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
  }, [stats, playing]);

  // Focus management (WCAG 2.4.3): move focus into the dialog on open, trap Tab
  // inside it, and return focus to whatever opened it on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel?.addEventListener("keydown", onKey);
    return () => {
      panel?.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="tsd-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${team.name} spotlight`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={`tsd-panel spot-panel panel brk${moreBelow ? " tsd-more-below" : ""}`}
        style={accentStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="br-tr" aria-hidden="true" />
        <span className="br-bl" aria-hidden="true" />

        <button className="tsd-close" type="button" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Hero */}
        <div className="spot-hero">
          <div className="spot-hero-logo">
            <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={56} />
          </div>
          <div className="spot-hero-text">
            {spot && (
              <span className="eyebrow-mono spot-eyebrow">{spot.narrative.tag}</span>
            )}
            <h3 className="spot-name font-display">{team.name}</h3>
            {spot && <p className="spot-seed">{spot.narrative.seedLine}</p>}
          </div>
          {stats?.worldRank != null && (
            <div className="tsd-rank" title={`HLTV world ranking #${stats.worldRank}`}>
              <span className="tsd-rank-num">#{stats.worldRank}</span>
              <span className="tsd-rank-lbl">WORLD</span>
            </div>
          )}
        </div>

        {/* Narrative */}
        {spot && (
          <section className="spot-sec">
            <div className="spot-story">
              <div className="spot-beat">
                <span className="spot-beat-tag">BEFORE</span>
                <p>{spot.narrative.before}</p>
              </div>
              <div className="spot-beat">
                <span className="spot-beat-tag now">NOW</span>
                <p>{spot.narrative.during}</p>
              </div>
            </div>
          </section>
        )}

        {/* Highlight */}
        {highlight && embedUrl && (
          <section className="spot-sec">
            <h4 className="tsd-sec-title">Highlight</h4>
            <div className="spot-clip">
              {playing ? (
                <iframe
                  className="spot-clip-frame"
                  src={`${embedUrl}&autoplay=1`}
                  title={`${team.name} highlight`}
                  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <button
                  type="button"
                  className="spot-clip-poster"
                  onClick={() => setPlaying(true)}
                  aria-label="Play highlight"
                  style={poster ? { backgroundImage: `url(${poster})` } : undefined}
                >
                  <span className="spot-clip-play" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </button>
              )}
            </div>
            <p className="spot-clip-cap">{highlight.caption}</p>
          </section>
        )}

        {/* Odds. A playoff team has no opponent until the bracket seeds, so the
            live line can't exist yet; show a "coming soon" state rather than
            hide the section, so the slot reads as intentional (Brandon). */}
        <section className="spot-sec">
          <h4 className="tsd-sec-title">Odds</h4>
          {market ? (
            <>
              <div className="spot-odds">
                <div className="spot-odds-row">
                  <span className="spot-odds-team">{market.teamName}</span>
                  <span className="spot-odds-pct heat">{Math.round(market.teamPct)}%</span>
                </div>
                <div className="spot-odds-bar" aria-hidden="true">
                  <span className="spot-odds-fill" style={{ width: `${market.teamPct}%` }} />
                </div>
                <div className="spot-odds-row dim">
                  <span className="spot-odds-team">{market.oppName}</span>
                  <span className="spot-odds-pct">{Math.round(market.oppPct)}%</span>
                </div>
              </div>
              <div className="spot-odds-foot">
                <span>
                  {market.sourceLabel} · updated {market.updatedLabel}
                </span>
                {market.hltvMatchUrl && (
                  <a href={market.hltvMatchUrl} target="_blank" rel="noopener noreferrer">
                    HLTV match
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 17 17 7M9 7h8v8" />
                    </svg>
                  </a>
                )}
              </div>
            </>
          ) : (
            <div className="spot-odds spot-odds-soon">
              <span className="spot-soon-dot" aria-hidden="true" />
              <p className="spot-soon-title">Market predictions coming soon</p>
              <p className="spot-soon-sub">
                Live win odds open once the playoff matchup is set, then refresh hourly.
              </p>
            </div>
          )}
        </section>

        {/* The tape, roster + last 5 (the old dossier, kept for scouts) */}
        {stats && (
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
            </section>

            <section className="tsd-sec">
              <h4 className="tsd-sec-title">Last 5</h4>
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
          </>
        )}

        {!spot && !stats && (
          <p className="tsd-empty">No spotlight on file for this team yet.</p>
        )}

        {stats?.hltvUrl && (
          <a className="tsd-link" href={stats.hltvUrl} target="_blank" rel="noopener noreferrer">
            HLTV profile
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </a>
        )}

        <p className="tsd-foot">Stats via HLTV · {asOf}</p>
      </div>
    </div>,
    document.body,
  );
}
