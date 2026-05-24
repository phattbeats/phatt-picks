"use client";

import Image from "next/image";
import { useState } from "react";
import type { LogoTier } from "@/lib/logos";

interface TeamLogoProps {
  tiers: LogoTier[]; // ordered candidates from resolveLogoTiers()
  teamName: string;
  size?: number;
}

/** Two-letter monogram badge — the terminal fallback and TBD slot. */
function Monogram({ label, teamName, size }: { label: string; teamName: string; size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--bg3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Rajdhani', sans-serif",
        fontWeight: 700,
        fontSize: size * 0.36,
        color: "var(--text-mid)",
        flexShrink: 0,
      }}
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

  return (
    <Image
      src={current.src}
      alt={teamName}
      title={teamName}
      width={size}
      height={size}
      style={{ borderRadius: 4, objectFit: "contain", flexShrink: 0 }}
      onError={() => setIndex((i) => i + 1)}
      unoptimized
    />
  );
}
