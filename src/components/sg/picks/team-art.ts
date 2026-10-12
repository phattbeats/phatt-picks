/**
 * Pick'Em board art helpers (Singapore skin, HANDOFF §3).
 *
 * Pool cards and the dossier use a player cutout when one ships in
 * /public/wrapped/player-<pickid>.webp; every other team falls back to its
 * colour + code. The set below mirrors the files actually committed — keep it in
 * sync when cutouts are added (an unlisted file simply isn't used).
 */
import type { TeamDef } from "@/lib/layout";
import { teamAccent } from "@/lib/playoff-spotlights";
import { monogramLabel } from "@/lib/logos";

const PLAYER_CUTOUTS = new Set<number>([59, 81, 85, 89, 112, 134, 137, 139]);

/** Cutout image for a team, or null when none is committed. */
export function playerCutout(pickid: number): string | null {
  return PLAYER_CUTOUTS.has(pickid) ? `/wrapped/player-${pickid}.webp` : null;
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
  if (label === "3:0 ADVANCED") return { title: "Sweep · 3–0", short: "3–0" };
  if (label.includes("0:3")) return { title: "Out · 0–3", short: "0–3" };
  if (label.includes("3:1") || label.includes("3:2")) return { title: "Advance", short: "ADV" };
  return { title: label, short: label };
}
