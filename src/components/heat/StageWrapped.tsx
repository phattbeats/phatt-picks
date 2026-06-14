"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildPlaceholderSlides,
  clampIndex,
  deckReducer,
  initialDeckState,
  progressLabel,
  resolveAutoAdvanceMs,
  wrappedSeenKey,
  type DeckState,
  type WrappedSlide,
} from "@/lib/stage-wrapped-core";

/**
 * Stage Wrapped (PHA-1052) — the reusable popup + click-through slide deck shell.
 *
 * This file is the *shell only*. It reuses the body-portal bottom-sheet pattern
 * and corner accents from `SpotlightModal`/`TeamStatsDrawer`, and the
 * one-time-per-stage dismissal idea from `HowToPlayAnnounce` (localStorage,
 * here keyed by event+stage). Slide *content* is data-driven (`WrappedSlide[]`)
 * so sibling content issues just supply data.
 *
 * Three pieces are exported:
 *   - <StageWrapped>          the controlled deck modal (open/onClose/slides)
 *   - <StageWrappedAnnounce>  self-contained auto-open-once-per-stage launcher
 *   - replayStageWrapped()    fire to re-open the deck from anywhere (header link)
 */

/* ------------------------------------------------------------------ */
/* Replay bus — lets a "replay" entry point anywhere re-open the deck   */
/* without prop-drilling through the page tree.                         */
/* ------------------------------------------------------------------ */

const REPLAY_EVENT = "stage-wrapped:replay";

/** Fire from any "Replay the recap" button; the matching launcher re-opens. */
export function replayStageWrapped(stageKey: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: { stageKey } }));
}

/* ------------------------------------------------------------------ */
/* The controlled deck modal                                            */
/* ------------------------------------------------------------------ */

interface StageWrappedProps {
  open: boolean;
  onClose: () => void;
  /** Ordered slides. Empty + not loading => graceful "nothing yet" card. */
  slides: WrappedSlide[];
  /** Deck title for the eyebrow/aria, e.g. "Stage I". */
  title?: string;
  /** Show the loading skeleton instead of slides. */
  loading?: boolean;
}

const SWIPE_THRESHOLD = 44; // px of horizontal travel to count as a swipe
// Tab-trap target set: anything tabbable inside the panel.
const FOCUSABLE_SEL =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Reactive `prefers-reduced-motion` read, so auto-advance can stand down. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function StageWrapped({ open, onClose, slides, title = "Stage", loading = false }: StageWrappedProps) {
  const count = slides.length;
  const [state, dispatch] = useReducer(deckReducer, count, initialDeckState);
  const reducedMotion = usePrefersReducedMotion();

  // Rebuild the cursor whenever the deck identity changes or it (re)opens, so a
  // replay always starts from slide 1 and a swapped-in deck doesn't keep a stale
  // index. Keyed on count + first/last id to catch content swaps. The reset
  // action also clears the sticky "user-controlled" flag.
  const deckSig = `${count}:${slides[0]?.id ?? ""}:${slides[count - 1]?.id ?? ""}`;
  useEffect(() => {
    dispatch({ type: "reset", count });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckSig, open]);

  // The reducer only re-clamps in the effect above, which runs *after* render;
  // derive the displayed cursor from the live `count` so a deck that shrinks
  // while open can never index past its slides for that transient frame.
  const safeIndex = clampIndex(state.index, count);
  const view: DeckState = { index: safeIndex, count };
  const first = safeIndex <= 0;
  const last = count === 0 || safeIndex >= count - 1;
  const current = slides[safeIndex];

  // Auto-advance (timer) — plain `next`, never marks the deck user-controlled.
  const goNext = useCallback(() => {
    if (count === 0 || state.index >= count - 1) {
      onClose();
      return;
    }
    dispatch({ type: "next" });
  }, [count, state.index, onClose]);

  // Manual paging carries `user: true` so the reducer flags control and
  // auto-advance steps aside for the rest of the deck.
  const userNext = useCallback(() => {
    if (count === 0 || state.index >= count - 1) {
      onClose();
      return;
    }
    dispatch({ type: "next", user: true });
  }, [count, state.index, onClose]);
  const userPrev = useCallback(() => dispatch({ type: "prev", user: true }), []);
  const userGoto = useCallback((index: number) => dispatch({ type: "goto", index, user: true }), []);

  const panelRef = useRef<HTMLDivElement>(null);

  // Keyboard: arrows page, Escape closes, Tab is trapped inside the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowRight") {
        userNext();
        return;
      }
      if (e.key === "ArrowLeft") {
        userPrev();
        return;
      }
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (focusables.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === firstEl || active === panel)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && active === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, userNext, userPrev]);

  // Optional per-slide auto-advance. Stands down for reduced-motion and once the
  // viewer takes manual control. Cleared on slide change / close / unmount.
  useEffect(() => {
    if (!open || loading) return;
    const ms = resolveAutoAdvanceMs(current, { reducedMotion, userControlled: !!state.controlled });
    if (ms == null) return;
    const t = setTimeout(goNext, ms);
    return () => clearTimeout(t);
  }, [open, loading, current, reducedMotion, state.controlled, goNext]);

  // Lock body scroll while the deck is open (it's a full takeover on mobile).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Focus management: pull focus into the panel on open, restore it on close so
  // keyboard users aren't dropped into the (inert) page behind the takeover.
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      restoreTo?.focus?.();
    };
  }, [open]);

  // Touch swipe — requires a dominantly-horizontal gesture so a vertical flick
  // (or a scroll that drifts sideways) can't page the deck.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = (t?.clientX ?? start.x) - start.x;
    const dy = (t?.clientY ?? start.y) - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) userNext();
    else userPrev();
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="tsd-backdrop sw-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} Wrapped`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="tsd-panel sw-panel panel brk"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <span className="br-tr" />
        <span className="br-bl" />

        <button className="tsd-close" type="button" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Progress dots */}
        {count > 0 && !loading && (
          <div className="sw-dots" role="tablist" aria-label="Slides">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === safeIndex}
                aria-label={`Slide ${i + 1} of ${count}`}
                className={`sw-dot${i === safeIndex ? " on" : ""}${i < safeIndex ? " past" : ""}`}
                onClick={() => userGoto(i)}
              />
            ))}
          </div>
        )}

        {/* Stage */}
        <div className="sw-stage">
          {loading ? (
            <SkeletonSlide />
          ) : count === 0 ? (
            <EmptySlide title={title} />
          ) : (
            // key=index remounts the card so the entrance animation re-fires.
            <SlideCard key={current.id} slide={current} />
          )}
        </div>

        {/* Footer controls */}
        {!loading && count > 0 && (
          <div className="sw-controls">
            <button
              type="button"
              className="sw-nav"
              onClick={userPrev}
              disabled={first}
              aria-label="Previous slide"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>
            <span className="sw-count">{progressLabel(view)}</span>
            <button type="button" className="sw-nav primary" onClick={userNext} aria-label={last ? "Finish" : "Next slide"}>
              {last ? "Done" : "Next"}
              {!last && (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Slide renderers                                                      */
/* ------------------------------------------------------------------ */

function SlideCard({ slide }: { slide: WrappedSlide }) {
  return (
    <div className={`sw-slide sw-kind-${slide.kind} sw-enter`}>
      {slide.eyebrow && <span className="eyebrow-mono sw-eyebrow">[ {slide.eyebrow} ]</span>}
      {slide.figure != null && (
        <div className="sw-figure font-display" aria-hidden={!slide.figureCaption}>
          {slide.figure}
        </div>
      )}
      {slide.figureCaption && <p className="sw-figcap">{slide.figureCaption}</p>}
      <h3 className="sw-headline font-display">{slide.headline}</h3>
      {slide.body && <p className="sw-body">{slide.body}</p>}
    </div>
  );
}

function SkeletonSlide() {
  return (
    <div className="sw-slide sw-skeleton" aria-busy="true" aria-label="Loading recap">
      <span className="sw-sk-line sw-sk-eyebrow" />
      <span className="sw-sk-line sw-sk-fig" />
      <span className="sw-sk-line sw-sk-head" />
      <span className="sw-sk-line sw-sk-body" />
      <span className="sw-sk-line sw-sk-body short" />
    </div>
  );
}

function EmptySlide({ title }: { title: string }) {
  return (
    <div className="sw-slide sw-empty sw-enter">
      <span className="eyebrow-mono sw-eyebrow">[ {title.toUpperCase()} · WRAPPED ]</span>
      <h3 className="sw-headline font-display">Nothing to wrap yet.</h3>
      <p className="sw-body">
        This stage&apos;s recap lands once it resolves. Check back when the games are in.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Self-contained auto-open-once-per-stage launcher                     */
/* ------------------------------------------------------------------ */

interface AnnounceProps {
  /** Stable per-stage id (event:section), from `stageWrappedKey`. */
  stageKey: string;
  /** Event + section ids for the localStorage seen-key. */
  eventId: number | string;
  sectionId: number | string;
  /** Ordered slides; when omitted the placeholder deck is shown. */
  slides?: WrappedSlide[];
  /** Deck title, e.g. "Stage I". */
  title?: string;
  /**
   * Only auto-open once the stage has actually resolved. Defaults to true so a
   * caller that only renders the launcher post-resolve gets the popup; pass
   * false to keep it replay-only.
   */
  resolved?: boolean;
  /** Show the loading skeleton (data still fetching). */
  loading?: boolean;
}

/**
 * Drop-in launcher that mirrors `HowToPlayAnnounce`: auto-opens the deck once
 * per stage (localStorage keyed by event+stage), remembers dismissal, and
 * re-opens on a `replayStageWrapped(stageKey)` event from any entry point.
 */
export function StageWrappedAnnounce({
  stageKey,
  eventId,
  sectionId,
  slides,
  title = "Stage",
  resolved = true,
  loading = false,
}: AnnounceProps) {
  const [open, setOpen] = useState(false);
  const deck = slides ?? buildPlaceholderSlides(title);
  const seenKey = wrappedSeenKey(eventId, sectionId);

  // Auto-open once, only after the stage resolved and there's something to show.
  useEffect(() => {
    if (!resolved || loading) return;
    try {
      if (!localStorage.getItem(seenKey)) setOpen(true);
    } catch {
      // Storage blocked (private mode) — skip the auto-popup, replay still works.
    }
  }, [resolved, loading, seenKey]);

  // Replay from any entry point re-opens regardless of seen-state.
  useEffect(() => {
    const onReplay = (e: Event) => {
      const detail = (e as CustomEvent<{ stageKey?: string }>).detail;
      if (!detail || detail.stageKey === stageKey) setOpen(true);
    };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, [stageKey]);

  const close = useCallback(() => {
    try {
      localStorage.setItem(seenKey, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }, [seenKey]);

  return <StageWrapped open={open} onClose={close} slides={deck} title={title} loading={loading} />;
}
