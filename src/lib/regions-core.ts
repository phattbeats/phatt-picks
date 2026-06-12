/**
 * Team regions (PHA-892) — pure data + helpers, keyed by Valve pickid so this
 * is loadable by the standalone verify script (plain Node, no `@/` alias /
 * bundler). The app imports the same map; rendering lives in RegionBadge.
 *
 * Regions use the colloquial CS2 buckets the board speaks in: NA, EU, SA, ASIA,
 * OCE. CIS rosters (NaVi, Spirit, BetBoom, B8, Monte, Parivision, Aurora) are
 * folded into EU to match the NA/EU/SA scheme in the issue — add a "CIS" code
 * here and re-tag those pickids if we ever want a dedicated chip.
 */

export type Region = "NA" | "EU" | "SA" | "ASIA" | "OCE";

export interface RegionMeta {
  code: Region;
  label: string; // long form for tooltips / a11y
  color: string; // chip accent
}

export const REGION_META: Record<Region, RegionMeta> = {
  NA: { code: "NA", label: "North America", color: "#4ea1ff" },
  EU: { code: "EU", label: "Europe", color: "#8b7bff" },
  SA: { code: "SA", label: "South America", color: "#f0a300" },
  ASIA: { code: "ASIA", label: "Asia", color: "#ff5d73" },
  OCE: { code: "OCE", label: "Oceania", color: "#2dd4a7" },
};

/**
 * pickid → region for the IEM Cologne 2026 field (32 teams). Assigned by org /
 * roster nationality; CIS folded into EU (see header).
 */
export const TEAM_REGIONS: Record<number, Region> = {
  12: "EU", // Natus Vincere (UA/CIS)
  48: "NA", // Team Liquid
  59: "EU", // G2 Esports
  60: "EU", // Astralis (DK)
  69: "EU", // BIG (DE)
  74: "ASIA", // Tyloo (CN)
  80: "SA", // MIBR (BR)
  81: "EU", // Team Spirit (CIS)
  85: "SA", // FURIA (BR)
  87: "NA", // NRG
  89: "EU", // Vitality (FR/intl)
  95: "EU", // HEROIC (intl)
  102: "SA", // paiN Gaming (BR)
  104: "SA", // Sharks Esports (BR)
  106: "EU", // MOUZ (intl)
  112: "SA", // 9z Team (AR)
  115: "EU", // GamerLegion (intl)
  119: "EU", // Monte (UA/CIS)
  122: "ASIA", // The MongolZ (MN)
  126: "SA", // Legacy (BR)
  127: "ASIA", // Lynn Vision (CN)
  132: "OCE", // Flyquest (AU roster)
  134: "EU", // Aurora (TR/CIS)
  135: "EU", // B8 (UA/CIS)
  137: "EU", // BetBoom (CIS)
  139: "EU", // Falcons (intl)
  140: "NA", // M80
  142: "EU", // Parivision (CIS)
  145: "EU", // FUT (TR)
  146: "EU", // Gaimin Gladiators (intl)
  147: "EU", // Sinners (CZ)
  148: "OCE", // THUNDER dOWNUNDER (AU)
};

/** Region code for a pickid, or null for TBD / unknown teams. */
export function regionForPickid(pickid: number): Region | null {
  return TEAM_REGIONS[pickid] ?? null;
}

/** Full region metadata for a pickid, or null for TBD / unknown teams. */
export function regionMetaForPickid(pickid: number): RegionMeta | null {
  const r = regionForPickid(pickid);
  return r ? REGION_META[r] : null;
}
