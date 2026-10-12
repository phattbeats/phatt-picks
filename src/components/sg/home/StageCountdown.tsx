"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Home countdown (Singapore skin, prototype 01-home). Big tabular-mono
 * days / hrs / min / sec under a mono label with an amber hairline.
 *
 * SSR-safe: the server passes its own request timestamp as `serverNow`, and the
 * first client render reuses it — so server HTML and the hydration render are
 * byte-identical (no mismatch), then the effect syncs to the wall clock and
 * ticks once a second. No animation, so there is nothing to reduce for
 * prefers-reduced-motion; digits simply change in place.
 *
 * When the target passes: renders the `live` link if given (e.g. "Stage I is
 * live" → /picks), otherwise nothing (the page's own state takes over).
 */
export function StageCountdown({
  target,
  serverNow,
  label,
  live,
  size = "lg",
}: {
  /** UTC ISO instant to count down to. */
  target: string;
  /** Server request time (epoch ms) — the first render's clock. */
  serverNow: number;
  /** Mono label above the digits, e.g. "Stage I · Opens 25 Nov · Singapore". */
  label: React.ReactNode;
  /** Shown once the instant has passed. Omit to render nothing then. */
  live?: { href: string; text: string };
  size?: "lg" | "md";
}) {
  const targetMs = Date.parse(target);
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    if (!Number.isFinite(targetMs)) return;
    // Post-hydration sync to the viewer's clock (the server stamp seeded the
    // first render so SSR and hydration agree).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= targetMs) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  if (!Number.isFinite(targetMs)) return null;
  const remaining = targetMs - now;

  if (remaining <= 0) {
    if (!live) return null;
    return (
      <div className="sgcd sgcd-done">
        <span className="sgcd-label">{label}</span>
        <Link href={live.href} prefetch={false} className="sgcd-live">
          <span className="live">Live</span>
          <span>{live.text}</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  const total = Math.floor(remaining / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const units: [string, string][] = [
    ...(d > 0 ? ([[String(d), d === 1 ? "day" : "days"]] as [string, string][]) : []),
    [pad(h), "hrs"],
    [pad(m), "min"],
    [pad(s), "sec"],
  ];
  const spoken = `${d > 0 ? `${d} days, ` : ""}${h} hours, ${m} minutes`;

  return (
    <div className={`sgcd sgcd-${size}`}>
      <span className="sgcd-label">{label}</span>
      <div className="sgcd-clock" role="timer" aria-label={spoken}>
        {units.map(([v, u]) => (
          <div key={u} aria-hidden="true">
            <b>{v}</b>
            <span>{u}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
