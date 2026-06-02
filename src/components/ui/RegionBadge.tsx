import type { CSSProperties } from "react";
import { regionMetaForPickid } from "@/lib/regions-core";

interface RegionBadgeProps {
  pickid: number;
  className?: string;
}

/**
 * Small region chip (NA / EU / SA / ASIA / OCE) for a team, keyed by pickid.
 * Renders nothing for TBD slots or teams with no mapped region, so it's safe to
 * drop in anywhere a team is shown.
 */
export function RegionBadge({ pickid, className }: RegionBadgeProps) {
  const meta = regionMetaForPickid(pickid);
  if (!meta) return null;
  return (
    <span
      className={`region-badge${className ? ` ${className}` : ""}`}
      style={{ "--region-color": meta.color } as CSSProperties}
      title={meta.label}
      aria-label={meta.label}
    >
      {meta.code}
    </span>
  );
}
