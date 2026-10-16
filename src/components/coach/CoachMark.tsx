"use client";

/**
 * <CoachMark> — one blue coach-mark bubble pointing at a UI element.
 *
 *   <CoachMark id="picks-buckets" anchor='[data-tip="picks-buckets"]' audience="new"
 *              title="Ten calls, three buckets">…copy…</CoachMark>
 *
 * - `anchor` is a CSS selector (first VISIBLE match wins — the header renders a
 *   desktop and a mobile copy) or a ref.
 * - Renders only for its audience, until dismissed (localStorage), and only
 *   while its anchor is on screen. Many may be mounted; the store shows ONE at
 *   a time (lowest `order`), the next after a dismiss.
 * - Positions with an arrow, flips above/below near viewport edges, clamps to
 *   the viewport, follows scroll/resize. Pauses while a modal is open.
 * - Non-modal and focus-safe: never steals focus; Esc dismisses; dismissing
 *   from inside the bubble returns focus to the anchor. Tapping the anchor
 *   itself also counts as "got it".
 * - No backdrop-filter / blur (#1269). Motion respects prefers-reduced-motion
 *   (sg-coach.css).
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { audienceMatches, placeBubble, type BubbleSide, type TipAudience, type TipPlacement } from "@/lib/coach-core";
import { coachStore, useCoach } from "./coach-store";

const WATCH_MS = 600;

function isVisibleEl(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

function resolveAnchor(anchor: string | RefObject<HTMLElement | null>): HTMLElement | null {
  if (typeof anchor !== "string") return anchor.current && isVisibleEl(anchor.current) ? anchor.current : null;
  for (const el of document.querySelectorAll<HTMLElement>(anchor)) if (isVisibleEl(el)) return el;
  return null;
}

/** Fixed chrome the bubble must not slide under: sticky header + bottom nav. */
function chromeInsets(anchorEl: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  for (const h of document.querySelectorAll<HTMLElement>(".topnav, .apphead")) {
    if (!isVisibleEl(h) || h.contains(anchorEl)) continue;
    top = Math.max(top, h.getBoundingClientRect().bottom);
  }
  let bottom = 0;
  const nav = document.querySelector<HTMLElement>(".botnav");
  if (nav && isVisibleEl(nav)) bottom = Math.max(0, window.innerHeight - nav.getBoundingClientRect().top);
  return { top, bottom };
}

function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

export function CoachMark({
  id,
  anchor,
  audience = "all",
  label = "Tip",
  title,
  children,
  placement = "auto",
  order = 100,
}: {
  id: string;
  anchor: string | RefObject<HTMLElement | null>;
  audience?: TipAudience;
  /** Pill text, e.g. "New". */
  label?: string;
  title: string;
  children: ReactNode;
  placement?: TipPlacement;
  /** Sequencing — lower shows first when several anchors are on screen. */
  order?: number;
}) {
  const { state, ready, activeId } = useCoach();
  const eligible = ready && !state.off && audienceMatches(audience, state.aud) && !state.seen.includes(id);
  const active = eligible && activeId === id;

  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: BubbleSide; arrowX: number } | null>(null);
  const uid = useId();
  const titleId = `${uid}-t`;
  const bodyId = `${uid}-b`;

  // Watch for the anchor: present + on screen + no modal → claim a slot.
  useEffect(() => {
    if (!eligible) {
      coachStore.release(id);
      return;
    }
    let raf = 0;
    const check = () => {
      raf = 0;
      const el = resolveAnchor(anchor);
      let onScreen = false;
      if (el && !modalOpen()) {
        const r = el.getBoundingClientRect();
        const ins = chromeInsets(el);
        onScreen = r.bottom > ins.top + 8 && r.top < window.innerHeight - ins.bottom - 8 && r.right > 0 && r.left < window.innerWidth;
      }
      anchorRef.current = onScreen ? el : null;
      if (onScreen) coachStore.claim(id, order);
      else coachStore.release(id);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    const iv = window.setInterval(check, WATCH_MS);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.clearInterval(iv);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      coachStore.release(id);
    };
  }, [eligible, anchor, id, order]);

  const dismiss = useCallback(
    (how: "got-it" | "off" | "anchor") => {
      const bubble = bubbleRef.current;
      const hadFocus = !!bubble && bubble.contains(document.activeElement);
      if (how === "off") coachStore.turnOff();
      else coachStore.dismiss(id);
      if (hadFocus) anchorRef.current?.focus({ preventScroll: true });
    },
    [id],
  );

  // Position against the anchor; follow scroll / resize while active.
  useLayoutEffect(() => {
    if (!active) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      const el = anchorRef.current;
      const b = bubbleRef.current;
      if (!el || !b) return;
      const r = el.getBoundingClientRect();
      const ins = chromeInsets(el);
      setPos(
        placeBubble({
          anchor: { top: r.top, left: r.left, width: r.width, height: r.height },
          bubble: { width: b.offsetWidth, height: b.offsetHeight },
          viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
          want: placement,
          topInset: ins.top,
          bottomInset: ins.bottom,
        }),
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const iv = window.setInterval(schedule, WATCH_MS);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearInterval(iv);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [active, placement]);

  // While active: Esc dismisses; tapping the anchor counts as "got it"; the
  // anchor is described by the bubble for screen readers.
  useEffect(() => {
    if (!active) return;
    const el = anchorRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !modalOpen()) dismiss("got-it");
    };
    const onAnchor = () => dismiss("anchor");
    document.addEventListener("keydown", onKey);
    el?.addEventListener("click", onAnchor);
    const prevDesc = el?.getAttribute("aria-describedby") ?? null;
    el?.setAttribute("aria-describedby", [prevDesc, bodyId].filter(Boolean).join(" "));
    return () => {
      document.removeEventListener("keydown", onKey);
      el?.removeEventListener("click", onAnchor);
      if (el) {
        if (prevDesc) el.setAttribute("aria-describedby", prevDesc);
        else el.removeAttribute("aria-describedby");
      }
    };
  }, [active, dismiss, bodyId]);

  if (!active || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={bubbleRef}
      className={`coach${pos ? " in" : ""}`}
      data-side={pos?.side ?? "bottom"}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, ["--coach-arrow" as string]: `${pos?.arrowX ?? 24}px` }}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-coach={id}
    >
      <span className="coach-arrow" aria-hidden />
      <div className="coach-head">
        <span className="coach-pill">{label}</span>
        <button type="button" className="coach-x" onClick={() => dismiss("got-it")} aria-label="Dismiss tip">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <p className="coach-t" id={titleId}>
        {title}
      </p>
      <div className="coach-b" id={bodyId}>
        {children}
      </div>
      <div className="coach-f">
        <button type="button" className="coach-off" onClick={() => dismiss("off")}>
          Turn off tips
        </button>
        <button type="button" className="coach-ok" onClick={() => dismiss("got-it")}>
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}
