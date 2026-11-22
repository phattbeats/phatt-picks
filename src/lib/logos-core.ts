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

/**
 * Self-hosted mark path, keyed by the layout's logo slug. WebP built from the
 * committed PNG by scripts/optimize-images.mjs (PHA-5360): fits 256×256.
 */
export function selfHostUrl(logoSlug: string): string {
  return `/logos/${logoSlug}.webp`;
}

/** Width descriptors of the two built sizes (fits 144×144 and 256×256). */
export const SELF_HOST_WIDTHS = { sm: 144, full: 256 } as const;

/**
 * `srcset` for a self-hosted mark (PHA-5360): a 144 px copy for list/tile sizes
 * and the 256 px one for big heroes, so a 24 px pool-card logo stops pulling a
 * 100 KB PNG. Pair with `sizes="<rendered css px>px"`. Returns undefined for any
 * URL that isn't a self-hosted mark (ByMykel stickers have one size).
 */
export function selfHostSrcSet(src: string): string | undefined {
  const m = /^\/logos\/([^/]+)\.webp$/.exec(src);
  if (!m) return undefined;
  return `/logos/sm/${m[1]}.webp ${SELF_HOST_WIDTHS.sm}w, ${src} ${SELF_HOST_WIDTHS.full}w`;
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
