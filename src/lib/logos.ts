/**
 * Team logo resolution (M6) — binds the committed ByMykel manifest
 * (src/fixtures/cologne-logos.json, built by scripts/build-logos.ts) to the
 * pure cascade in logos-core.ts. The app imports from here; the cascade logic
 * and its tests live in logos-core.ts.
 */

import manifest from "@/fixtures/cologne-logos.json";
import {
  resolveLogoTiers as resolveLogoTiersCore,
  type LogoMap,
  type ResolvableTeam,
  type LogoTier,
} from "./logos-core";

export type { LogoTier, ResolvableTeam } from "./logos-core";
export { selfHostUrl, monogramLabel } from "./logos-core";

const LOGOS: LogoMap = (manifest as { logos: LogoMap }).logos;

/** Ordered logo candidates for a team, against the committed manifest. */
export function resolveLogoTiers(team: ResolvableTeam): LogoTier[] {
  return resolveLogoTiersCore(team, LOGOS);
}
