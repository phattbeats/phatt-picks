/**
 * The locked 32-team wall: the faded contenders wall at full size, a region
 * chip and a form badge under each mark, every tile a link to /teams/[slug].
 * Marks come up in team colour on hover/tap. Pure server markup — motion is
 * CSS only, no client JS.
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
  /** The team's id in the Valve layout; logo keys differ between the two files. */
  pickid?: number;
}

export function FieldGrid({ field }: { field: FieldEntry[] }) {
  const teams = fieldTeams(servedLayout());
  const byPickid = new Map(teams.map((t) => [t.pickid, t]));
  const byLogo = new Map(teams.map((t) => [t.logo, t]));
  const tiles = field.map((f) => {
    const team = (f.pickid != null ? byPickid.get(f.pickid) : undefined) ?? byLogo.get(f.logo);
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
