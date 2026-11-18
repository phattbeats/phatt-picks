"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Publish the fixed bar's real height as --sgp-bar-h so `.sgp-page.with-bar`
 * pads by what the bar actually occupies instead of a magic number.
 */
export function useBarHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--sgp-bar-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--sgp-bar-h");
    };
  }, []);
  return ref;
}

export type BarTone = "ok" | "warn" | "err" | "info";

/**
 * Sticky Pick'Em action bar (HANDOFF §3 / §5b): sits above the mobile bottom
 * nav (bottom: 64px + safe area), flush to the viewport foot on desktop. Shows
 * a 10-tick progress strip, the calls count, a save state, and an optional CTA.
 * Presentational only — LockInStage supplies the Steam CTA + state when the
 * player is Steam-linked; PicksBoard renders it bare otherwise.
 */
export function ActionBar({
  filled,
  total,
  state,
  tone = "info",
  cta,
}: {
  filled: number;
  total: number;
  state: ReactNode;
  tone?: BarTone;
  cta?: ReactNode;
}) {
  const ticks = Math.max(total, 1);
  const ref = useBarHeight<HTMLDivElement>();
  return (
    <div ref={ref} className="sgp-action" role="region" aria-label="Pick progress">
      <div className="sgp-action-in">
        <div className="sgp-prog">
          <div className="c">
            <span>
              <b>{filled}</b>/{total} calls
            </span>
            <span className={`s${tone === "info" ? "" : ` ${tone}`}`} aria-live="polite">
              {state}
            </span>
          </div>
          <div className="sgp-ticks" aria-hidden="true">
            {Array.from({ length: ticks }, (_, i) => (
              <i key={i} className={i < filled ? "on" : undefined} />
            ))}
          </div>
        </div>
        {cta}
      </div>
    </div>
  );
}

/** Signed-out variant of the bar; client component so it can publish its height. */
export function SignInBar() {
  const ref = useBarHeight<HTMLDivElement>();
  return (
    <div ref={ref} className="sgp-action" role="region" aria-label="Sign in">
      <div className="sgp-action-in">
        <div className="sgp-prog">
          <div className="c">
            <span className="s">Sign in to save your calls.</span>
          </div>
        </div>
        <Link href="/login" className="btn-solid" prefetch={false}>
          Sign in to Save
        </Link>
      </div>
    </div>
  );
}
