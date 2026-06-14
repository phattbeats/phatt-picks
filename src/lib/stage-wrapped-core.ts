/**
 * Stage Wrapped — the data + state core for the click-through recap deck
 * (PHA-1052). When a Swiss stage resolves we want to hand the player a short,
 * Spotify-Wrapped-style story: a handful of slides they tap through (their
 * picks, the stage's big moments, where they landed). This module is the pure,
 * testable spine of that feature — the *shell*: the typed slide model and the
 * slide-cursor reducer. The actual moment data + clips arrive from sibling
 * issues as `WrappedSlide[]`; this file knows nothing about how they're sourced.
 *
 * Everything here is framework-free so `verify-stage-wrapped.ts` can exercise
 * the reducer offline. The React popup shell (`StageWrapped.tsx`) owns timers,
 * gestures and localStorage; this owns *what the deck is* and *which slide
 * you're on*.
 */

import type { LogoTier } from "./logos-core";

/** The visual template a slide renders with. The shell ships generic layouts; */
/** sibling content issues pick the kind per moment. */
export type WrappedSlideKind =
  | "intro" // cover card — "Stage I, Wrapped"
  | "stat" // one big figure + caption
  | "moment" // a narrative beat (optional media handled by the shell later)
  | "standings" // where you / the field landed
  | "outro" // closer / share prompt
  | "placeholder"; // shell-only filler until real data lands

/** A resolved team logo for a slide (cascade tiers + name), serializable for RSC. */
export interface WrappedTeamLogo {
  tiers: LogoTier[];
  name: string;
}

/** A brand mark (game / major logo) rendered on intro/outro/brand slides. */
export interface WrappedBrandLogo {
  src: string;
  alt: string;
  /** White-treat a dark logo for the dark deck (brightness(0) invert(1)). */
  invert?: boolean;
}

/** The viewer's avatar for personal slides; `src` null falls back to initials. */
export interface WrappedAvatar {
  src: string | null;
  label: string;
}

/** A stylized STAGE logo lockup (HEAT brand) — hero mark on the cover/closer. */
export interface WrappedStageBadge {
  /** Roman numeral, e.g. "I" / "II" / "III". */
  numeral: string;
  /** Word above the numeral (default "STAGE"). */
  label?: string;
  /** Caption under the numeral, e.g. "WRAPPED". */
  sub?: string;
}

export interface WrappedSlide {
  /** Stable id (used as the animation remount key + dot aria labels). */
  id: string;
  kind: WrappedSlideKind;
  /** Mono eyebrow, e.g. "STAGE I · WRAPPED" or "BIG MOMENT". */
  eyebrow?: string;
  /** The slide's main line. Required — an empty slide is meaningless. */
  headline: string;
  /** Optional supporting paragraph. */
  body?: string;
  /** A hero figure for `stat` slides, e.g. "73%" or "8-2". */
  figure?: string;
  /** Caption under the figure, e.g. "of your Stage I picks hit". */
  figureCaption?: string;
  /** 1–3 team logos to render as a visual row (matchups, clinchers). */
  teamLogos?: WrappedTeamLogo[];
  /** A brand mark (major / game logo) for cover + closer slides. */
  brandLogo?: WrappedBrandLogo;
  /** The viewer's avatar, for personal slides. */
  avatar?: WrappedAvatar;
  /** A stylized STAGE logo lockup, for the cover + closer. */
  stageBadge?: WrappedStageBadge;
  /**
   * Per-slide auto-advance, in ms. Falsy / omitted => this slide waits for the
   * user. The shell clamps to a sane floor so a stray `1` can't strobe.
   */
  autoAdvanceMs?: number;
}

/** Floor for auto-advance so authored data can't produce a strobe. */
export const MIN_AUTO_ADVANCE_MS = 1200;

/**
 * Resolve the effective auto-advance delay for a slide, or `null` when the deck
 * should wait for the user. Auto-advance is suppressed when:
 *   - the slide didn't ask for it (falsy / non-positive `autoAdvanceMs`),
 *   - the viewer prefers reduced motion (auto-moving content is exactly what
 *     that setting asks us to stop — WCAG 2.2.2 / 2.3.3), or
 *   - the viewer has taken manual control of the deck (we never page out from
 *     under someone who is clicking/swiping through it themselves).
 * Honoured delays are floored to `MIN_AUTO_ADVANCE_MS` so authored data can't
 * strobe. Pure so the shell's pacing rule is asserted offline.
 */
export function resolveAutoAdvanceMs(
  slide: Pick<WrappedSlide, "autoAdvanceMs"> | undefined,
  opts: { reducedMotion?: boolean; userControlled?: boolean } = {},
): number | null {
  const requested = slide?.autoAdvanceMs;
  if (!requested || requested <= 0) return null;
  if (opts.reducedMotion || opts.userControlled) return null;
  return Math.max(MIN_AUTO_ADVANCE_MS, requested);
}

/* ------------------------------------------------------------------ */
/* Deck cursor reducer                                                 */
/* ------------------------------------------------------------------ */

export interface DeckState {
  /** Current slide, always clamped into [0, count-1] (or 0 when empty). */
  index: number;
  /** Total slide count this deck was built for. */
  count: number;
  /**
   * Sticky once the viewer pages the deck themselves (a `user: true` action).
   * The shell reads this to stand auto-advance down so it never pages out from
   * under someone in manual control. Reset by `reset`.
   */
  controlled?: boolean;
}

export type DeckAction =
  /** `user: true` marks the deck viewer-controlled (manual page vs. auto-advance). */
  | { type: "next"; user?: boolean }
  | { type: "prev"; user?: boolean }
  | { type: "goto"; index: number; user?: boolean }
  /** Rebuild for a (possibly new) slide list — resets the cursor to 0. */
  | { type: "reset"; count: number };

/** Clamp n into [0, count-1]; 0 when the deck is empty. */
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (index < 0) return 0;
  if (index > count - 1) return count - 1;
  return Math.trunc(index);
}

/**
 * Pure cursor reducer. `next` past the last slide and `prev` before the first
 * are no-ops (they clamp) — the shell decides what "next on the last slide"
 * means (it closes the deck), so the reducer never wraps or overshoots.
 */
export function deckReducer(state: DeckState, action: DeckAction): DeckState {
  switch (action.type) {
    case "next":
      return {
        ...state,
        index: clampIndex(state.index + 1, state.count),
        controlled: state.controlled || !!action.user,
      };
    case "prev":
      return {
        ...state,
        index: clampIndex(state.index - 1, state.count),
        controlled: state.controlled || !!action.user,
      };
    case "goto":
      return {
        ...state,
        index: clampIndex(action.index, state.count),
        controlled: state.controlled || !!action.user,
      };
    case "reset":
      return { count: Math.max(0, Math.trunc(action.count)), index: 0, controlled: false };
    default:
      return state;
  }
}

export function initialDeckState(count: number): DeckState {
  return { index: 0, count: Math.max(0, Math.trunc(count)), controlled: false };
}

export function isFirstSlide(state: DeckState): boolean {
  return state.index <= 0;
}

export function isLastSlide(state: DeckState): boolean {
  return state.count <= 0 || state.index >= state.count - 1;
}

/** 0-based step → 1-based "3 / 7" progress label. Safe on empty decks. */
export function progressLabel(state: DeckState): string {
  if (state.count <= 0) return "0 / 0";
  return `${state.index + 1} / ${state.count}`;
}

/* ------------------------------------------------------------------ */
/* One-time-per-stage seen-state (key only; storage lives in the shell)*/
/* ------------------------------------------------------------------ */

/** Bump to re-show every stage's deck after a major shell rewrite. */
export const WRAPPED_SEEN_VERSION = "v1";

/**
 * The localStorage key for "has this device already seen the wrapped deck for
 * this exact stage". Keyed by event + section so each Major's each stage is its
 * own one-time popup. Pure so it can be asserted offline.
 */
export function wrappedSeenKey(eventId: number | string, sectionId: number | string): string {
  return `hotline:wrapped-seen:${WRAPPED_SEEN_VERSION}:${eventId}:${sectionId}`;
}

/** A stable per-stage identity passed to the shell (event:section). */
export function stageWrappedKey(eventId: number | string, sectionId: number | string): string {
  return `${eventId}:${sectionId}`;
}

/** Parse the roman numeral out of a stage label like "Stage II" → "II". Pure. */
export function stageNumeral(stageName: string): string {
  const m = stageName.match(/\b([IVX]+)\b/i);
  if (m) return m[1].toUpperCase();
  const n = stageName.match(/\b(\d+)\b/);
  if (n) {
    const map: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV", "5": "V" };
    return map[n[1]] ?? n[1];
  }
  return stageName.replace(/^stage\s+/i, "").toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Placeholder deck — shell demo until sibling content issues land     */
/* ------------------------------------------------------------------ */

/**
 * A small, honest placeholder deck so the shell is demonstrable and reviewable
 * before the real moment data exists. The Stage 1 content issue replaces this
 * with a builder over real picks/standings — the shell consumes `WrappedSlide[]`
 * and does not care which.
 */
export function buildPlaceholderSlides(stageName: string): WrappedSlide[] {
  const eyebrow = `${stageName.toUpperCase()} · WRAPPED`;
  return [
    {
      id: "intro",
      kind: "intro",
      eyebrow,
      headline: `${stageName} is a wrap.`,
      body: "The dust settled. Here's your stage, in five cards — tap through.",
      autoAdvanceMs: 5200,
    },
    {
      id: "stat-picks",
      kind: "stat",
      eyebrow: "YOUR CARD",
      headline: "You called it.",
      figure: "—%",
      figureCaption: "Your hit-rate drops in here once the stage data is wired.",
      autoAdvanceMs: 5200,
    },
    {
      id: "moment",
      kind: "moment",
      eyebrow: "MOMENT OF THE STAGE",
      headline: "The one nobody saw coming.",
      body: "The upset, the clutch, the elimination that reshuffled the board — straight from the moments feed.",
      autoAdvanceMs: 5200,
    },
    {
      id: "standings",
      kind: "standings",
      eyebrow: "WHERE YOU LANDED",
      headline: "Your spot on the board.",
      figure: "#—",
      figureCaption: "Your rank against the field lands here.",
      autoAdvanceMs: 5200,
    },
    {
      id: "outro",
      kind: "outro",
      eyebrow,
      headline: "On to the next one.",
      body: "Replay this any time from the stage header. See you next stage.",
    },
  ];
}
