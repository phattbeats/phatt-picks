/**
 * Team logo resolution (M6) — binds the committed ByMykel manifest
 * (src/fixtures/cologne-logos.json, built by scripts/build-logos.ts) and the
 * self-hosted team-mark index (src/fixtures/team-marks.json, built by
 * scripts/build-team-marks.ts) to the pure cascade in logos-core.ts. The app imports from here; the cascade logic
 * and its tests live in logos-core.ts.
 */

import manifest from "@/fixtures/cologne-logos.json";
import singaporeManifest from "@/fixtures/pgl-singapore-2026-logos.json";
import teamMarks from "@/fixtures/team-marks.json";
import singaporeField from "@/fixtures/singapore-field.json";
import {
  resolveLogoTiers as resolveLogoTiersCore,
  type LogoMap,
  type ResolvableTeam,
  type LogoTier,
} from "./logos-core";

export type { LogoTier, ResolvableTeam } from "./logos-core";
export { selfHostUrl, selfHostSrcSet, monogramLabel } from "./logos-core";

// Pickids are stable per team across Majors, so a later event overrides an earlier
// one and teams without a new sticker keep the previous event's mark.
const LOGOS: LogoMap = {
  ...(manifest as { logos: LogoMap }).logos,
  ...(singaporeManifest as { logos: LogoMap }).logos,
};
/** Slugs with a self-hosted team mark in public/logos (scripts/build-team-marks.ts). */
const MARKS: ReadonlySet<string> = new Set((teamMarks as { marks: string[] }).marks);

/**
 * pickid → the mark the Singapore home wall uses. Valve's layout codes some
 * teams differently from their org's mark file (`thv` vs `100t`, `pvis` vs
 * `pari`) and the licensing renames (The One, GOSH, BB Team) play under their
 * org's mark, so a layout slug with no mark of its own borrows the field's.
 */
const FIELD_MARKS: ReadonlyMap<number, string> = new Map(
  (singaporeField as { teams: { pickid: number; logo: string }[] }).teams.map((t) => [t.pickid, t.logo]),
);

function withMark<T extends ResolvableTeam>(team: T): T {
  if (MARKS.has(team.logo)) return team;
  const mark = FIELD_MARKS.get(team.pickid);
  return mark && MARKS.has(mark) ? { ...team, logo: mark } : team;
}

/** Ordered logo candidates for a team: its own mark first when one ships, then the sticker. */
export function resolveLogoTiers(team: ResolvableTeam): LogoTier[] {
  return resolveLogoTiersCore(withMark(team), LOGOS, MARKS);
}

/** True when public/logos/<slug>.webp ships (so an <img> for it never 404s). */
export function hasTeamMark(slug: string): boolean {
  return MARKS.has(slug);
}
