"use client";

import { useEffect, useState } from "react";

/**
 * Renders a results "last updated" line in the viewer's local timezone plus a
 * live-ageing relative label (handoff §16: scores-stale degraded state +
 * display times in the viewer's local tz). Refreshes the age every 30s.
 */
export function LastUpdated({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const then = new Date(iso).getTime();
  const ageMin = Math.max(0, Math.floor((now - then) / 60_000));
  const age =
    ageMin < 1 ? "just now" : ageMin < 60 ? `${ageMin}m ago` : ageMin < 1440 ? `${Math.floor(ageMin / 60)}h ago` : `${Math.floor(ageMin / 1440)}d ago`;
  const local = new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <>
      Results as of {local} · {age}
    </>
  );
}
