/**
 * Team page helpers (Singapore skin, prototype 05). Pure — no prisma, no React —
 * so client components (bracket picker, standings) and the server route share
 * one definition of a team's URL slug and portrait.
 */

import { TEAM_SOURCES } from "@/lib/team-stats-sources";

/** Lowercase, hyphenated, ASCII-only handle from a free-form name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Stable URL slug for a team: the HLTV profile slug when the team is in the
 * source map (e.g. "natus-vincere", "the-mongolz"), else its slugified name.
 * Both are fixed per Major, so a link never changes under a viewer.
 */
export function teamSlug(team: { pickid: number; name: string }): string {
  return TEAM_SOURCES[team.pickid]?.slug ?? slugify(team.name);
}

/** In-app link to a team's page. */
export function teamHref(team: { pickid: number; name: string }): string {
  return `/teams/${teamSlug(team)}`;
}

/**
 * Teams with a cleared HLTV player cutout at /public/wrapped/player-<pickid>.webp
 * (see /public/wrapped/CREDITS.md). Others fall back to the team logo.
 */
const PORTRAIT_PICKIDS: ReadonlySet<number> = new Set([59, 81, 85, 89, 112, 134, 137, 139]);

export function teamPortrait(pickid: number): string | null {
  return PORTRAIT_PICKIDS.has(pickid) ? `/wrapped/player-${pickid}.webp` : null;
}

/** Short broadcast code for the ghost type behind the hero ("NAVI", "G2"). */
export function teamCode(team: { logo: string; name: string }): string {
  const fromLogo = team.logo.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (fromLogo.length >= 2 && fromLogo.length <= 4) return fromLogo;
  return team.name.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase();
}
