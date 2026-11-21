/**
 * Teams index — every team in the committed Major field, each linking to its
 * /teams/[slug] page. Read-only, no DB access.
 */

import Link from "next/link";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import { regionMetaForPickid } from "@/lib/regions-core";
import { statsForPickid } from "@/lib/team-stats-core";
import { fieldTeams, servedLayout } from "@/components/sg/teams/team-data";
import { teamHref } from "@/components/sg/teams/team-assets";

export const metadata = { title: "Teams · HOTLINE" };

export default function TeamsIndexPage() {
  const layout = servedLayout();
  const field = fieldTeams(layout)
    .map((t) => ({ t, rank: statsForPickid(t.pickid)?.worldRank ?? null, region: regionMetaForPickid(t.pickid) }))
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.t.name.localeCompare(b.t.name));

  return (
    <div className="sg-page sgt">
      <header className="page-head">
        <span className="eyebrow">
          <b>{field.length}</b> teams
        </span>
        <h1 className="display">The field.</h1>
      </header>
      <div className="sgt-index hair-list">
        {field.map(({ t, rank, region }) => (
          <Link key={t.pickid} href={teamHref(t)} prefetch={false} className="sgt-index-row">
            <span className="mono muted rk">{rank != null ? `#${rank}` : "—"}</span>
            <span className="sgt-chip-logo">
              <TeamLogo tiers={resolveLogoTiers(t)} teamName={t.name} size={28} />
            </span>
            <span className="nm">{t.name}</span>
            <span className="mono muted rg">{region?.code ?? ""}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
