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
import { TeamLogo } from "@/components/ui/TeamLogo";
import { StageLogo } from "@/components/heat/StageLogo";

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

  // The live segment's fill races the active slide's auto-advance; null when the
  // deck is waiting on the user (so the segment just reads as fully-elapsed).
  const autoMs = resolveAutoAdvanceMs(current, { reducedMotion, userControlled: !!state.controlled });

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

  // Optional epic soundtrack (PHA-1054). Off by default — the deck auto-opens
  // without a user gesture, and browsers block autoplay-with-sound there, so we
  // never blare uninvited. One tap on the sound toggle starts the (looping)
  // royalty-free theme; closing the deck stops it.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [soundOn, setSoundOn] = useState(false);
  const toggleSound = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    setSoundOn((on) => {
      if (on) {
        el.pause();
        return false;
      }
      el.volume = 0.55;
      void el.play().catch(() => {});
      return true;
    });
  }, []);
  // Stop + reset the track whenever the deck closes.
  useEffect(() => {
    if (open) return;
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setSoundOn(false);
  }, [open]);

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
    if (!open || loading || autoMs == null) return;
    const t = setTimeout(goNext, autoMs);
    return () => clearTimeout(t);
  }, [open, loading, autoMs, goNext]);

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

        {/* Epic royalty-free soundtrack — "The Descent" by Kevin MacLeod (CC-BY 3.0). */}
        <audio ref={audioRef} src="/audio/wrapped-theme.mp3" loop preload="none" aria-hidden="true" />
        <button
          className="sw-sound"
          type="button"
          aria-pressed={soundOn}
          aria-label={soundOn ? "Mute soundtrack" : "Play epic soundtrack"}
          title={soundOn ? "Mute" : "Play epic soundtrack — 'The Descent', Kevin MacLeod (CC-BY)"}
          onClick={toggleSound}
          style={{
            position: "absolute",
            top: 10,
            left: 12,
            zIndex: 2,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 9px",
            background: soundOn ? "rgba(240,163,0,0.14)" : "transparent",
            border: "1px solid var(--hair-2)",
            borderColor: soundOn ? "var(--heat)" : "var(--hair-2)",
            color: soundOn ? "var(--heat)" : "var(--ink-mid)",
            borderRadius: 4,
            cursor: "pointer",
            font: "inherit",
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
            {soundOn ? (
              <>
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M18.5 5.5a9 9 0 0 1 0 13" />
              </>
            ) : (
              <line x1="16" y1="9" x2="22" y2="15" />
            )}
            {!soundOn && <line x1="22" y1="9" x2="16" y2="15" />}
          </svg>
          <span className="eyebrow-mono" style={{ fontSize: 9, letterSpacing: "0.12em" }}>
            {soundOn ? "SOUND ON" : "MUSIC"}
          </span>
        </button>

        <button className="tsd-close" type="button" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Progress dots */}
        {count > 0 && !loading && (
          <div className="sw-dots" role="tablist" aria-label="Slides">
            {slides.map((s, i) => {
              const isOn = i === safeIndex;
              const ticking = isOn && autoMs != null;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={isOn}
                  aria-label={`Slide ${i + 1} of ${count}`}
                  className={`sw-dot${isOn ? " on" : ""}${i < safeIndex ? " past" : ""}${ticking ? " auto" : ""}`}
                  style={ticking ? ({ "--sw-fill-ms": `${autoMs}ms` } as React.CSSProperties) : undefined}
                  onClick={() => userGoto(i)}
                >
                  <span className="sw-dot-fill" />
                </button>
              );
            })}
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

/**
 * The documentary photo band (PHA-1274 "dank HLTV photo" twist). If the image
 * fails to load it hides itself rather than leaving a broken-image icon — this
 * is what lets us *reserve a spot* for a still that isn't licensed/dropped in
 * yet (e.g. the magixx 1v4 reaction): author the beat now, drop the file into
 * /public/wrapped later, and the band appears with zero code change. Until then
 * the slide's copy + logos carry it.
 */
function PhotoFigure({ photo }: { photo: NonNullable<WrappedSlide["photo"]> }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="sw-photo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.src}
        alt={photo.alt}
        style={{ objectPosition: photo.focus ?? "50% 50%" }}
        onError={() => setFailed(true)}
      />
      {photo.credit && <figcaption>{photo.credit}</figcaption>}
    </figure>
  );
}

function SlideCard({ slide }: { slide: WrappedSlide }) {
  const logos = slide.teamLogos ?? [];
  const badge = slide.stageBadge;
  return (
    <div className={`sw-slide sw-kind-${slide.kind} sw-enter`}>
      {/* Documentary photo (PHA-1274 "dank HLTV photo" twist) — a hero band that
          leads the slide: the Cologne cathedral, the arena crowd, a player
          mid-scream. Sits above the copy with a fade into the deck so the text
          stays legible; credit rides along the bottom edge. */}
      {slide.photo && <PhotoFigure photo={slide.photo} />}
      {/* Brand mark (major / game logo) — cover + closer slides. Smaller when a
          stage badge is the hero so the STAGE logo leads. */}
      {slide.brandLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="sw-brand"
          src={slide.brandLogo.src}
          alt={slide.brandLogo.alt}
          style={{
            height: badge ? 34 : 52,
            width: "auto",
            maxWidth: "60%",
            objectFit: "contain",
            display: "block",
            margin: badge ? "0 auto 10px" : "0 auto 16px",
            opacity: badge ? 0.85 : 1,
            filter: slide.brandLogo.invert ? "brightness(0) invert(1)" : undefined,
          }}
        />
      )}
      {/* Stage logo (HEAT v3 lockup) — the hero mark; replaces the plain eyebrow. */}
      {badge ? (
        <div style={{ margin: "2px 0 10px" }}>
          <StageLogo numeral={badge.numeral} label={badge.label} sub={badge.sub} />
        </div>
      ) : (
        slide.eyebrow && <span className="eyebrow-mono sw-eyebrow">{slide.eyebrow}</span>
      )}
      {/* Team logos — matchups / clinchers. One logo centred; two flank a "vs". */}
      {logos.length > 0 && (
        <div
          className="sw-logos"
          style={{ display: "flex", gap: 16, justifyContent: "center", alignItems: "center", margin: "6px 0 12px" }}
        >
          {logos.map((t, i) => (
            <span key={`${t.name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
              {i > 0 && (
                <span
                  className="font-display"
                  aria-hidden="true"
                  style={{ color: "var(--ink-low)", fontWeight: 700, fontSize: 18 }}
                >
                  {logos.length === 2 ? "vs" : "·"}
                </span>
              )}
              <TeamLogo tiers={t.tiers} teamName={t.name} size={72} />
            </span>
          ))}
        </div>
      )}
      {/* Player avatar — personal slides. */}
      {slide.avatar && <SlideAvatar avatar={slide.avatar} />}
      {slide.figure != null && (
        <div className="sw-figure font-display" aria-hidden={!slide.figureCaption}>
          {slide.figure}
        </div>
      )}
      {slide.figureCaption && <p className="sw-figcap">{slide.figureCaption}</p>}
      <h3 className="sw-headline font-display">{slide.headline}</h3>
      {/* Personal reward — the viewer's pick matched this narrative moment. */}
      {slide.calledIt && (
        <div
          className="sw-calledit brk"
          style={{
            position: "relative",
            margin: "12px auto 2px",
            padding: "8px 16px",
            border: "1px solid var(--heat)",
            background: "rgba(240,163,0,0.12)",
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            boxShadow: "0 0 18px var(--heat-glow)",
          }}
        >
          <span className="br-tr" />
          <span className="br-bl" />
          <span className="font-display foil" style={{ fontWeight: 800, fontSize: 17, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            ✓ {slide.calledIt.label}
          </span>
          {slide.calledIt.sub && (
            <span className="eyebrow-mono" style={{ color: "var(--heat)", fontSize: 9.5, letterSpacing: "0.16em" }}>
              {slide.calledIt.sub}
            </span>
          )}
        </div>
      )}
      {slide.body && <p className="sw-body">{slide.body}</p>}
    </div>
  );
}

/** Circular viewer avatar; falls back to initials when there's no image. */
function SlideAvatar({ avatar }: { avatar: NonNullable<WrappedSlide["avatar"]> }) {
  const initials = avatar.label
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
  const size = 64;
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    margin: "4px auto 12px",
    border: "2px solid var(--hair-3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    background: "var(--surf-2, rgba(255,255,255,0.04))",
  };
  if (avatar.src) {
    return (
      <div style={base}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatar.src} alt={avatar.label} width={size} height={size} style={{ objectFit: "cover", width: "100%", height: "100%" }} />
      </div>
    );
  }
  return (
    <div style={base} aria-label={avatar.label} title={avatar.label}>
      <span className="font-display" style={{ fontWeight: 800, fontSize: 24, color: "var(--ink-hi)" }}>{initials}</span>
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
      <span className="eyebrow-mono sw-eyebrow">{title.toUpperCase()} · WRAPPED</span>
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
  /**
   * Force the deck open once on mount, bypassing the once-per-stage seen-flag.
   * Set when the viewer arrived via the recap notification deep-link
   * (`/reveal/<id>?wrapped=1`) so the cinematic recap re-opens even on a device
   * that already dismissed the auto-popup (PHA-1245 follow-up).
   */
  forceOpen?: boolean;
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
  forceOpen = false,
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

  // Deep-link force-open (PHA-1245 follow-up): the recap notification lands here
  // with ?wrapped=1, so re-open the deck once even if this device already saw it.
  // Also stamp the seen-flag so the app-wide auto-launcher (StageWrappedGate)
  // won't pop a second copy for this same stage.
  const forcedRef = useRef(false);
  useEffect(() => {
    if (!forceOpen || loading || forcedRef.current) return;
    forcedRef.current = true;
    try {
      localStorage.setItem(seenKey, "1");
    } catch {
      /* storage blocked — still open below */
    }
    setOpen(true);
  }, [forceOpen, loading, seenKey]);

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
