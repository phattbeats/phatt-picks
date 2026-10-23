/**
 * Team logo resolution (M6) — binds the committed ByMykel manifest
 * (src/fixtures/cologne-logos.json, built by scripts/build-logos.ts) and the
 * self-hosted team-mark index (src/fixtures/team-marks.json, built by
 * scripts/build-team-marks.ts) to the pure cascade in logos-core.ts. The app imports from here; the cascade logic
 * and its tests live in logos-core.ts.
 */

import manifest from "@/fixtures/cologne-logos.json";
import teamMarks from "@/fixtures/team-marks.json";
import {
  resolveLogoTiers as resolveLogoTiersCore,
  type LogoMap,
  type ResolvableTeam,
  type LogoTier,
} from "./logos-core";

export type { LogoTier, ResolvableTeam } from "./logos-core";
export { selfHostUrl, monogramLabel } from "./logos-core";

const LOGOS: LogoMap = (manifest as { logos: LogoMap }).logos;
/** Slugs with a self-hosted team mark in public/logos (scripts/build-team-marks.ts). */
const MARKS: ReadonlySet<string> = new Set((teamMarks as { marks: string[] }).marks);

/** Ordered logo candidates for a team: its own mark first when one ships, then the sticker. */
export function resolveLogoTiers(team: ResolvableTeam): LogoTier[] {
  return resolveLogoTiersCore(team, LOGOS, MARKS);
}

/** True when public/logos/<slug>.png ships (so an <img> for it never 404s). */
export function hasTeamMark(slug: string): boolean {
  return MARKS.has(slug);
}
