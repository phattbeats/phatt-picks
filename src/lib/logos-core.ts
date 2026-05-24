/**
 * Pure logo-cascade logic (M6) — no manifest/alias imports, so it is loadable
 * by the standalone verify script (plain Node can't resolve the `@/` alias).
 * src/lib/logos.ts binds the committed manifest to these functions for the app.
 *
 * Three-tier cascade, in order:
 *   1. ByMykel  — image URL from the manifest (primary).
 *   2. self-host — /logos/<logo>.svg, keyed by the layout's `logo` slug.
 *   3. monogram  — derived initials; terminal, never fails.
 * TBD slots (pickid 0) skip straight to a "?" monogram.
 */

export type LogoTier =
  | { kind: "image"; src: string; source: "bymykel" | "selfhost" }
  | { kind: "monogram"; label: string };

export interface LogoEntry {
  name: string;
  logo: string;
  tag: string | null;
  image: string;
  effect: string;
  matchedBy: "tag" | "name";
}

export type LogoMap = Record<string, LogoEntry>;

export interface ResolvableTeam {
  pickid: number;
  logo: string;
  name: string;
}

/** Self-hosted fallback path, keyed by the layout's logo slug. */
export function selfHostUrl(logoSlug: string): string {
  return `/logos/${logoSlug}.svg`;
}

/** Up-to-two-letter monogram; "?" for TBD / empty. */
export function monogramLabel(name: string): string {
  if (name === "TBD" || !name.trim()) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Ordered logo candidates for a team. First that loads wins; last is terminal. */
export function resolveLogoTiers(team: ResolvableTeam, logos: LogoMap): LogoTier[] {
  if (team.pickid === 0) {
    return [{ kind: "monogram", label: "?" }];
  }

  const tiers: LogoTier[] = [];
  const url = logos[String(team.pickid)]?.image;
  if (url) tiers.push({ kind: "image", src: url, source: "bymykel" });
  tiers.push({ kind: "image", src: selfHostUrl(team.logo), source: "selfhost" });
  tiers.push({ kind: "monogram", label: monogramLabel(team.name) });
  return tiers;
}
