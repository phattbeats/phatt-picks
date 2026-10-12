import type { ReactNode } from "react";

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
  return (
    <div className="sgp-action" role="region" aria-label="Pick progress">
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
