"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildPlaceholderSlides,
  deckReducer,
  initialDeckState,
  isFirstSlide,
  isLastSlide,
  MIN_AUTO_ADVANCE_MS,
  progressLabel,
  wrappedSeenKey,
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

export function StageWrapped({ open, onClose, slides, title = "Stage", loading = false }: StageWrappedProps) {
  const count = slides.length;
  const [state, dispatch] = useReducer(deckReducer, count, initialDeckState);

  // Rebuild the cursor whenever the deck identity changes or it (re)opens, so a
  // replay always starts from slide 1 and a swapped-in deck doesn't keep a stale
  // index. Keyed on count + first/last id to catch content swaps.
  const deckSig = `${count}:${slides[0]?.id ?? ""}:${slides[count - 1]?.id ?? ""}`;
  useEffect(() => {
    dispatch({ type: "reset", count });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckSig, open]);

  const goNext = useCallback(() => {
    if (isLastSlide(state)) {
      onClose();
      return;
    }
    dispatch({ type: "next" });
  }, [state, onClose]);

  const goPrev = useCallback(() => dispatch({ type: "prev" }), []);

  // Keyboard: arrows page, Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, goNext, goPrev]);

  // Optional per-slide auto-advance. Cleared on slide change / close / unmount.
  const current = slides[state.index];
  useEffect(() => {
    if (!open || loading || !current?.autoAdvanceMs) return;
    const ms = Math.max(MIN_AUTO_ADVANCE_MS, current.autoAdvanceMs);
    const t = setTimeout(goNext, ms);
    return () => clearTimeout(t);
  }, [open, loading, current, goNext]);

  // Lock body scroll while the deck is open (it's a full takeover on mobile).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Touch swipe.
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.changedTouches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx < 0) goNext();
    else goPrev();
  };

  if (!open || typeof document === "undefined") return null;

  const last = isLastSlide(state);
  const first = isFirstSlide(state);

  return createPortal(
    <div
      className="tsd-backdrop sw-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} Wrapped`}
      onClick={onClose}
    >
      <div
        className="tsd-panel sw-panel panel brk"
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
                aria-selected={i === state.index}
                aria-label={`Slide ${i + 1}`}
                className={`sw-dot${i === state.index ? " on" : ""}${i < state.index ? " past" : ""}`}
                onClick={() => dispatch({ type: "goto", index: i })}
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
              onClick={goPrev}
              disabled={first}
              aria-label="Previous slide"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>
            <span className="sw-count">{progressLabel(state)}</span>
            <button type="button" className="sw-nav primary" onClick={goNext} aria-label={last ? "Finish" : "Next slide"}>
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
