/**
 * The locked 32-team wall: big full-colour tiles in each team's colour, a
 * region chip and a form badge, every tile a link to /teams/[slug]. Pure
 * server markup — hover/tap motion is CSS only, no client JS.
 */
import Link from "next/link";
import { selfHostUrl } from "@/lib/logos";
import { regionMetaForPickid } from "@/lib/regions-core";
import { statsForPickid } from "@/lib/team-stats-core";
import { teamHref } from "@/components/sg/teams/team-assets";
import { fieldTeams, servedLayout } from "@/components/sg/teams/team-data";
import colors from "@/fixtures/team-colors.json";

interface FieldEntry {
  logo: string;
  name: string;
}

export function FieldGrid({ field }: { field: FieldEntry[] }) {
  const byLogo = new Map(fieldTeams(servedLayout()).map((t) => [t.logo, t]));
  const tiles = field.map((f) => {
    const team = byLogo.get(f.logo);
    const rank = team ? statsForPickid(team.pickid)?.worldRank ?? null : null;
    return {
      ...f,
      href: team ? teamHref(team) : null,
      region: team ? regionMetaForPickid(team.pickid) : null,
      color: (colors as Record<string, string>)[f.logo] ?? "#8a93a6",
      badge: rank != null && rank <= 8 ? "Favourite" : null,
      rank,
    };
  });

  return (
    <ul className="hm-grid" aria-label="Teams locked">
      {tiles.map((t, i) => {
        const inner = (
          <>
            {t.badge && <span className="hm-tile-badge">{t.badge}</span>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selfHostUrl(t.logo)} alt="" width={96} height={96} loading={i < 8 ? "eager" : "lazy"} decoding="async" />
            <span className="hm-tile-name">{t.name}</span>
            {t.region && (
              <span className="hm-tile-region" title={t.region.label}>
                {t.region.code}
              </span>
            )}
          </>
        );
        return (
          <li key={t.logo} style={{ ["--tc" as string]: t.color, ["--i" as string]: i }}>
            {t.href ? (
              <Link href={t.href} prefetch={false} className="hm-tile" aria-label={`${t.name} — storyline`}>
                {inner}
              </Link>
            ) : (
              <div className="hm-tile">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
