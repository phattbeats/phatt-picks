/**
 * Live-layout overlay (pure).
 *
 * The committed cologne-layout fixture is the *structural* source of truth —
 * section/group ids, points_per_pick, the pick slots and their answer-key
 * `pickids`. What it CANNOT know ahead of time is which teams fill each group as
 * the tournament progresses: Stage III's 8 advancers (the fixture ships them as
 * `pickid:0` TBD alongside the 8 already-known), and the entire playoff bracket
 * (QF/SF/GF — every slot TBD until Valve seeds it). Valve's GetTournamentLayout
 * carries those teams live, plus the live `picks_allowed` window flag.
 *
 * `mergeLiveLayout` overlays exactly those two live facts — per-group `teams` and
 * `picks_allowed` — onto the fixture, matched by (sectionid, groupid). Everything
 * else stays the fixture's, so the slot structure and the outcomes answer-key are
 * untouched (those flow through the outcomes path, PHA-869). Top-level team defs
 * are unioned so any team the live layout introduces still resolves a logo/name.
 *
 * Defensive by contract (rules #7/#8): a missing / empty / still-all-TBD live
 * group leaves the fixture group's teams untouched, so a partial or pre-seed
 * payload can never blank out a stage the fixture already seeds. A null live
 * layout returns the fixture verbatim — a cold cache is exactly today's behavior.
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under `node`.
 */

import type { Layout, TeamDef, TeamSlot } from "./layout";

/** Does this team-slot list seed at least one real (non-TBD) team? */
function hasRealTeam(teams: ReadonlyArray<TeamSlot> | undefined): boolean {
  return Array.isArray(teams) && teams.some((t) => t && t.pickid !== 0);
}

export function mergeLiveLayout(committed: Layout, live: Layout | null | undefined): Layout {
  if (!live?.sections) return committed;

  // (sectionid:groupid) -> live group, for O(1) overlay lookup.
  const liveGroups = new Map<string, Layout["sections"][number]["groups"][number]>();
  for (const s of live.sections) {
    for (const g of s.groups ?? []) {
      liveGroups.set(`${s.sectionid}:${g.groupid}`, g);
    }
  }

  const sections = committed.sections.map((s) => ({
    ...s,
    groups: s.groups.map((g) => {
      const lg = liveGroups.get(`${s.sectionid}:${g.groupid}`);
      if (!lg) return g;
      const liveTeams = Array.isArray(lg.teams)
        ? lg.teams.filter((t): t is TeamSlot => !!t && typeof t.pickid === "number")
        : [];
      return {
        ...g,
        // Adopt live teams only once they actually seed something — a live group
        // that is still empty / all-TBD must not erase fixture-seeded teams.
        teams: hasRealTeam(liveTeams) ? liveTeams : g.teams,
        // `picks_allowed` always tracks live: this is the wiring the stage gate's
        // `locked-by-valve` branch was waiting on (the fixture ships all-open).
        picks_allowed:
          typeof lg.picks_allowed === "boolean" ? lg.picks_allowed : g.picks_allowed,
      };
    }),
  }));

  // Union team defs: fixture first, live overrides/extends by pickid so a
  // live-only logo/name still resolves a pool tile.
  const teamMap = new Map<number, TeamDef>();
  for (const t of committed.teams) teamMap.set(t.pickid, t);
  for (const t of live.teams ?? []) {
    if (t && typeof t.pickid === "number") {
      teamMap.set(t.pickid, { ...teamMap.get(t.pickid), ...t });
    }
  }

  return { ...committed, sections, teams: [...teamMap.values()] };
}
