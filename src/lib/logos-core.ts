/**
 * Pure logo-cascade logic (M6) — no manifest/alias imports, so it is loadable
 * by the standalone verify script (plain Node can't resolve the `@/` alias).
 * src/lib/logos.ts binds the committed manifest to these functions for the app.
 *
 * Three-tier cascade, in order:
 *   1. ByMykel  — image URL from the manifest (the tournament sticker).
 *   2. self-host — /logos/<logo>.png, keyed by the layout's `logo` slug.
 *   3. monogram  — derived initials; terminal, never fails.
 * When the caller passes the committed set of self-hosted MARKS (the team's
 * own logo, scripts/build-team-marks.ts) and the team has one, the self-host
 * tier is promoted to first: the ByMykel sticker carries tournament art (the
 * Cologne roundel + "Cologne 2026" lettering) that reads as a grey disc at tile
 * size, so it becomes the fallback. TBD slots (pickid 0) skip straight to a
 * "?" monogram.
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
  return `/logos/${logoSlug}.png`;
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
export function resolveLogoTiers(
  team: ResolvableTeam,
  logos: LogoMap,
  marks?: ReadonlySet<string>,
): LogoTier[] {
  if (team.pickid === 0) {
    return [{ kind: "monogram", label: "?" }];
  }

  const url = logos[String(team.pickid)]?.image;
  const sticker: LogoTier | null = url ? { kind: "image", src: url, source: "bymykel" } : null;
  const selfhost: LogoTier = { kind: "image", src: selfHostUrl(team.logo), source: "selfhost" };
  const ordered: (LogoTier | null)[] = marks?.has(team.logo) ? [selfhost, sticker] : [sticker, selfhost];
  const tiers = ordered.filter((t): t is LogoTier => t !== null);
  tiers.push({ kind: "monogram", label: monogramLabel(team.name) });
  return tiers;
}
