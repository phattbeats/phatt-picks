/**
 * Name fitting for display type — player names set in the big condensed
 * display face (compare hero, leaderboard podium, profile hero).
 *
 * The rule (Brandon): a player's name is ALWAYS fully visible unless it's
 * something ridiculous (> NAME_FIT_MAX characters). So instead of a fixed
 * font-size + ellipsis, the type is sized to the container:
 *
 *   font-size = clamp(min, 100cqi / (lineChars × CHAR_EM), max)
 *
 * where `lineChars` is how many characters must fit on ONE line. Short names
 * stay on one line (lineChars = length); longer names are allowed a 2-line wrap
 * (lineChars ≈ half, but never shorter than the longest word, so a name only
 * breaks mid-word when it has no spaces and simply can't fit). The CSS reads
 * `--nf-chars` from the inline style and does the arithmetic with container
 * query units, so it's exact for any width with zero JS.
 *
 * Over NAME_FIT_MAX the name is clamped to two lines with an ellipsis — the
 * only case where truncation is allowed.
 *
 * Pure + server-safe (type-only React import), so it's usable from RSCs and
 * verify scripts alike.
 */

import type { CSSProperties } from "react";

/** Beyond this many characters a name may be truncated (2-line clamp). */
export const NAME_FIT_MAX = 35;

/** Names up to this length always render on a single line. */
export const NAME_FIT_ONE_LINE = 14;

/** A name with no spaces stays on one line up to this length (no mid-word break). */
export const NAME_FIT_SPACELESS_ONE_LINE = 24;

/** Count user-perceived characters (surrogate pairs / most emoji count once). */
export function nameLength(name: string): number {
  return [...name.trim()].length;
}

/**
 * How many characters the widest line of `name` will hold once wrapped.
 * One line for short names; otherwise half the name (+1 for the space it breaks
 * on), floored at the longest word so wrapping prefers spaces.
 */
export function nameLineChars(name: string): number {
  const n = Math.max(1, nameLength(name));
  if (n <= NAME_FIT_ONE_LINE) return n;
  const longestWord = Math.max(1, ...name.trim().split(/\s+/).map((w) => [...w].length));
  const half = Math.ceil(n / 2) + 1;
  // A spaceless name can't wrap on a space: keep it on one (smaller) line while
  // that's still legible, and only past that let it break mid-word at half.
  if (longestWord >= n) return n <= NAME_FIT_SPACELESS_ONE_LINE ? n : half;
  return Math.min(n, Math.max(half, longestWord, NAME_FIT_ONE_LINE));
}

export interface NameFitProps {
  className: string;
  style: CSSProperties;
}

/**
 * className + inline style for a display-type player name. Spread onto the
 * element that holds the name text; its CSS context (`.nfit` rules in
 * sg-ranks.css) supplies min/max sizes per surface.
 */
export function nameFit(name: string, extraClass = ""): NameFitProps {
  const cls = ["nfit", nameLength(name) > NAME_FIT_MAX ? "nfit-clamp" : "", extraClass].filter(Boolean).join(" ");
  return { className: cls, style: { "--nf-chars": nameLineChars(name) } as CSSProperties };
}
