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

/** The visual template a slide renders with. The shell ships generic layouts; */
/** sibling content issues pick the kind per moment. */
export type WrappedSlideKind =
  | "intro" // cover card — "Stage I, Wrapped"
  | "stat" // one big figure + caption
  | "moment" // a narrative beat (optional media handled by the shell later)
  | "standings" // where you / the field landed
  | "outro" // closer / share prompt
  | "placeholder"; // shell-only filler until real data lands

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
  /**
   * Per-slide auto-advance, in ms. Falsy / omitted => this slide waits for the
   * user. The shell clamps to a sane floor so a stray `1` can't strobe.
   */
  autoAdvanceMs?: number;
}

/** Floor for auto-advance so authored data can't produce a strobe. */
export const MIN_AUTO_ADVANCE_MS = 1200;

/* ------------------------------------------------------------------ */
/* Deck cursor reducer                                                 */
/* ------------------------------------------------------------------ */

export interface DeckState {
  /** Current slide, always clamped into [0, count-1] (or 0 when empty). */
  index: number;
  /** Total slide count this deck was built for. */
  count: number;
}

export type DeckAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "goto"; index: number }
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
      return { ...state, index: clampIndex(state.index + 1, state.count) };
    case "prev":
      return { ...state, index: clampIndex(state.index - 1, state.count) };
    case "goto":
      return { ...state, index: clampIndex(action.index, state.count) };
    case "reset":
      return { count: Math.max(0, Math.trunc(action.count)), index: 0 };
    default:
      return state;
  }
}

export function initialDeckState(count: number): DeckState {
  return { index: 0, count: Math.max(0, Math.trunc(count)) };
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
      body: "Here's how it shook out. Tap through — three quick cards.",
    },
    {
      id: "stat-picks",
      kind: "stat",
      eyebrow: "YOUR STAGE",
      headline: "Your picks, scored.",
      figure: "—",
      figureCaption: "Real numbers land here once the stage data is wired.",
    },
    {
      id: "moment",
      kind: "moment",
      eyebrow: "BIG MOMENT",
      headline: "The moment of the stage.",
      body: "The upset, the clutch, the elimination that reshuffled the board — populated by the moments feed.",
    },
    {
      id: "outro",
      kind: "outro",
      eyebrow,
      headline: "On to the next one.",
      body: "You can replay this any time from the stage header.",
    },
  ];
}
