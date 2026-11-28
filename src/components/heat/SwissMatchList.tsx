/**
 * Server wrapper for the Swiss "Matches" list (PHA-5538): flattens the cached
 * HLTV bracket into kick-off order and resolves each side's logo and team link
 * here (the logo registry and team slugs stay server-side), then hands plain
 * data to the client list, which groups by the viewer's local day.
 */

import type { TeamDef } from "@/lib/layout";
import { resolveLogoTiers } from "@/lib/logos";
import { teamHref } from "@/components/sg/teams/team-assets";
import type { BracketSide, SwissRound } from "@/lib/swiss-bracket-core";
import { flattenSwissSchedule } from "@/lib/match-schedule-core";
import { MatchSchedule, type SchedSideView } from "./MatchSchedule";

export function SwissMatchList({
  rounds,
  teamMap,
  source,
  sourceUrl,
  fetchedAtIso,
  className,
}: {
  rounds: SwissRound[];
  teamMap: Map<number, TeamDef>;
  source: string;
  sourceUrl: string;
  fetchedAtIso: string;
  className?: string;
}) {
  const view = (s: BracketSide): SchedSideView => {
    const team = s.pickid != null ? teamMap.get(s.pickid) : undefined;
    return {
      name: s.name,
      pickid: s.pickid,
      score: s.score,
      winner: s.winner,
      label: team?.name ?? s.name,
      tiers: team ? resolveLogoTiers(team) : null,
      href: team ? teamHref(team) : null,
    };
  };
  const matches = flattenSwissSchedule(
    rounds.map((r) => ({
      label: r.label,
      kind: r.kind,
      matches: r.matches.map((m) => ({ ...m, team1: view(m.team1), team2: view(m.team2) })),
    })),
  );
  if (matches.length === 0) return null;
  return (
    <MatchSchedule
      matches={matches}
      source={source}
      sourceUrl={sourceUrl}
      fetchedAtIso={fetchedAtIso}
      className={className}
    />
  );
}
