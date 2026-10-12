"use client";

import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { statsForPickid, TEAM_STATS_AS_OF, type TeamStats } from "@/lib/team-stats-core";
import { regionMetaForPickid } from "@/lib/regions-core";
import { playerCutout, teamCode, teamColor } from "@/components/sg/picks/team-art";

interface Props {
  team: TeamDef;
  onClose: () => void;
  /**
   * Live dossier for this team (#921), with `recent[]` pulled live for the
   * current stage. Preferred over the frozen snapshot when present; undefined
   * off-window / cold start, in which case the frozen snapshot is shown.
   */
  liveStats?: TeamStats;
  /** Snapshot date of the live crawl (YYYY-MM-DD); falls back to the frozen label. */
  liveAsOf?: string;
  /** Live partial Swiss record this stage, when the bracket is revealed. */
  record?: { wins: number; losses: number };
}

/**
 * Team dossier (#893) — photo, HLTV rank, last five results, Swiss record and
 * roster. Off-board by default: it surfaces only when a player taps the `i` on
 * a pool card. Pure-data backed (team-stats-core), so it degrades to "no stats
 * yet" for TBD slots.
 *
 * Singapore skin (HANDOFF §3): a bottom sheet on mobile (88dvh) and a right
 * drawer from 760px. Rendered through a body portal (#897) so the root-level
 * bottom nav can't paint over it — `main.shell` is its own stacking context.
 * The scrim is a solid dim, no blur (#1269).
 *
 * #921: the "Last 5" refresh per stage on their own — the picks page passes
 * `liveStats` (recent[] live, roster/rank frozen), preferred over the committed
 * snapshot, which remains the fallback off-window / before the first crawl.
 */
export function TeamStatsDrawer({ team, onClose, liveStats, liveAsOf, record }: Props) {
  // Esc closes — modal convention; scrim click also closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Scroll lock while the sheet is open, restored on close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Prefer the live per-stage dossier; fall back to the committed frozen snapshot.
  const stats = liveStats ?? statsForPickid(team.pickid);
  const asOf = (liveStats && liveAsOf) || TEAM_STATS_AS_OF;
  const region = regionMetaForPickid(team.pickid);
  const color = teamColor(team);
  const cutout = playerCutout(team.pickid);
  const ratings = (stats?.roster ?? []).map((p) => p.rating).filter((r): r is number => r != null);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  // Only ever rendered client-side (opened by a tap, so absent from SSR output);
  // bail if document is somehow unavailable rather than crash createPortal.
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="sgp-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        className="sgp-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${team.name} statistics and standings`}
        style={color ? ({ "--team": color } as CSSProperties) : undefined}
      >
        <button className="close" type="button" aria-label="Close" onClick={onClose} autoFocus>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="sgp-dh">
          {cutout ? (
            <Image src={cutout} alt="" fill sizes="400px" />
          ) : (
            <span className="big" aria-hidden="true">
              {teamCode(team)}
            </span>
          )}
          <span className="logo">
            <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={40} />
          </span>
        </div>

        <div className="sgp-db">
          <div className="eyebrow">
            {stats?.worldRank != null ? (
              <>
                HLTV <b>#{stats.worldRank}</b>
              </>
            ) : (
              "Team dossier"
            )}
            {region ? ` · ${region.label}` : ""}
          </div>
          <h2 className="display">{team.name}</h2>

          {!stats ? (
            <p className="muted">No stats on file for this team yet.</p>
          ) : (
            <>
              <div className="sgp-dstats">
                <div>
                  <span className="k">Last 5</span>
                  {stats.recent.length > 0 ? (
                    <span
                      className="sgp-form"
                      role="img"
                      aria-label={`Last ${stats.recent.length}: ${stats.recent.map((m) => m.result).join(" ")}`}
                    >
                      {stats.recent.slice(0, 5).map((m, i) => (
                        <i key={i} className={m.result === "L" ? "l" : m.result === "T" ? "t" : undefined} />
                      ))}
                    </span>
                  ) : (
                    <span className="v">—</span>
                  )}
                </div>
                <div>
                  <span className="k">Swiss record</span>
                  <span className="v">{record ? `${record.wins}–${record.losses}` : "—"}</span>
                </div>
                <div>
                  <span className="k">Avg rating</span>
                  <span className="v">{avgRating != null ? avgRating.toFixed(2) : "—"}</span>
                </div>
              </div>

              <section className="sgp-dsec">
                <div className="eyebrow">Roster</div>
                <ul className="sgp-roster">
                  {stats.roster.map((p) => (
                    <li key={p.name}>
                      <a href={p.hltvUrl} target="_blank" rel="noopener noreferrer">
                        {p.name}
                      </a>
                      <span className={`tag${p.position.toLowerCase() === "igl" ? " ok" : p.position.toLowerCase() === "awp" ? " warn" : ""}`}>
                        {p.position}
                      </span>
                      <span className="rt" title="HLTV rating on this team">
                        {p.rating != null ? p.rating.toFixed(2) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="sgp-dsec">
                <div className="eyebrow">Last 5 matches</div>
                {stats.recent.length === 0 ? (
                  <p className="muted">No recent matches on file.</p>
                ) : (
                  <ul className="sgp-matches">
                    {stats.recent.map((m, i) => (
                      <li
                        key={`${m.date}-${i}`}
                        className={m.result === "W" ? "w" : m.result === "L" ? "l" : "t"}
                      >
                        <span className="r">{m.result}</span>
                        <span className="o">vs {m.opponent}</span>
                        <span className="sc">{m.score}</span>
                        <span className="d">{m.date}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {stats.hltvUrl && (
                <a className="btn-ghost" href={stats.hltvUrl} target="_blank" rel="noopener noreferrer">
                  Full profile on HLTV
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 17 17 7M9 7h8v8" />
                  </svg>
                </a>
              )}
            </>
          )}

          <p className="sgp-dfoot">World ranking &amp; results via HLTV · snapshot {asOf}</p>
        </div>
      </aside>
    </>,
    document.body,
  );
}
