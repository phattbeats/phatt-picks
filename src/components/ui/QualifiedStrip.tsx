"use client";

import { useState, type CSSProperties } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import { SpotlightModal } from "@/components/ui/SpotlightModal";
import { teamAccent, authoredSpotlightPickids } from "@/lib/playoff-spotlights";
import type { TeamDef } from "@/lib/layout";
import type { TeamStats } from "@/lib/team-stats-core";

interface Props {
  teams: TeamDef[];
  liveTeamStats?: Record<number, TeamStats>;
  liveStatsAsOf?: string;
}

/**
 * "Qualified for Playoffs" strip (PHA-1043, Brandon: make the field feel named
 * before Valve seeds). The playoff picker tiles are empty until seeding, so this
 * anticipation row surfaces every team that has clinched AND been authored a
 * Spotlight: a tap opens the full Spotlight. It is driven by the authored
 * spotlight set, so the pipeline adding a team (FURIA, Spirit, then the waves)
 * lights it up here automatically. Renders nothing until at least one team is
 * authored, and the playoffs view drops it once the real bracket seeds.
 */
export function QualifiedStrip({ teams, liveTeamStats, liveStatsAsOf }: Props) {
  const [openTeam, setOpenTeam] = useState<TeamDef | null>(null);

  const byId = new Map(teams.map((t) => [t.pickid, t]));
  const qualified = authoredSpotlightPickids()
    .map((id) => byId.get(id))
    .filter((t): t is TeamDef => !!t);

  if (qualified.length === 0) return null;

  return (
    <section className="qstrip">
      <span className="eyebrow-mono qstrip-label">
        Qualified for playoffs · {qualified.length}/8
      </span>
      <div className="qstrip-row">
        {qualified.map((t) => {
          const accent = teamAccent(t);
          const style = accent ? ({ "--team-accent": accent } as CSSProperties) : undefined;
          return (
            <button
              key={t.pickid}
              type="button"
              className="qstrip-tile"
              style={style}
              onClick={() => setOpenTeam(t)}
              aria-label={`${t.name} spotlight`}
            >
              <span className="qstrip-logo">
                <TeamLogo tiers={resolveLogoTiers(t)} teamName={t.name} size={40} />
              </span>
              <span className="qstrip-name">{t.name}</span>
              <span className="qstrip-star" aria-hidden="true">
                {"★"}
              </span>
            </button>
          );
        })}
      </div>
      {openTeam && (
        <SpotlightModal
          team={openTeam}
          onClose={() => setOpenTeam(null)}
          liveStats={liveTeamStats?.[openTeam.pickid]}
          liveAsOf={liveStatsAsOf}
        />
      )}
    </section>
  );
}
