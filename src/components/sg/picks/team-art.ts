/**
 * Pick'Em board art helpers (Singapore skin, HANDOFF §3).
 *
 * Pool cards and the dossier use the team's player cutout (teamPortrait: a
 * pinned face from TEAM_FACE_PINS, else the curated wrapped portrait, else the
 * top-rated starter's HLTV bodyshot); a team with none falls back to its
 * colour + code.
 */
import type { TeamDef } from "@/lib/layout";
import { teamAccent } from "@/lib/playoff-spotlights";
import { monogramLabel } from "@/lib/logos";
import { teamPortrait } from "@/components/sg/teams/team-assets";

/** Cutout image for a team (shared with the team page), or null when none ships. */
export function playerCutout(pickid: number): string | null {
  return teamPortrait(pickid);
}

/** The team's colour (hex) for tiles and radials, or null for the neutral surface. */
export function teamColor(team: Pick<TeamDef, "logo">): string | null {
  return teamAccent(team);
}

/** Short code for the oversized background monogram (e.g. "VIT", "G2"). */
export function teamCode(team: Pick<TeamDef, "name" | "logo">): string {
  const slug = team.logo?.trim();
  if (slug && slug.length <= 4) return slug.toUpperCase();
  return monogramLabel(team.name);
}

/** Bucket label from swiss-bucket-core → the Singapore board label. */
export function bucketDisplay(label: string): { title: string; short: string } {
  if (label === "3:0 ADVANCED") return { title: "3-0", short: "3-0" };
  if (label.includes("0:3")) return { title: "0-3", short: "0-3" };
  if (label.includes("3:1") || label.includes("3:2")) return { title: "Advancing", short: "ADV" };
  return { title: label, short: label };
}
