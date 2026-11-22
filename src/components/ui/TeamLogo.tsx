"use client";

import { useState } from "react";
import { selfHostSrcSet, type LogoTier } from "@/lib/logos";

interface TeamLogoProps {
  tiers: LogoTier[]; // ordered candidates from resolveLogoTiers()
  teamName: string;
  size?: number;
}

/** Two-letter monogram badge — the terminal fallback and TBD slot. */
function Monogram({ label, teamName, size }: { label: string; teamName: string; size: number }) {
  return (
    <div
      className="team-mono"
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      aria-label={teamName}
      title={teamName}
    >
      {label}
    </div>
  );
}

/**
 * Renders the first logo tier that loads, advancing past image tiers that
 * 404 / fail. The last tier is always a monogram, so this can never render
 * a broken image.
 */
export function TeamLogo({ tiers, teamName, size = 32 }: TeamLogoProps) {
  const [index, setIndex] = useState(0);
  const current = tiers[Math.min(index, tiers.length - 1)];

  if (!current || current.kind === "monogram") {
    return <Monogram label={current?.kind === "monogram" ? current.label : "?"} teamName={teamName} size={size} />;
  }

  // Plain <img> (was next/image `unoptimized`, which renders the same tag but
  // can't take a srcset). The srcset lets a small tile pull the 144 px mark and a
  // hero the 256 px one (PHA-5360); lazy because most logos sit below the fold.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current.src}
      srcSet={selfHostSrcSet(current.src)}
      sizes={`${size}px`}
      alt={teamName}
      title={teamName}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      style={{ borderRadius: "var(--r-md)", objectFit: "contain", flexShrink: 0 }}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}
