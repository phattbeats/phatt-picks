"use client";

import Image from "next/image";
import { useState } from "react";

interface TeamLogoProps {
  logoSlug: string;   // from layout's team.logo field
  teamName: string;
  pickid: number;     // 0 = TBD
  size?: number;
  byMykelUrl?: string; // resolved URL from ByMykel (optional)
}

/** Two-letter monogram for fallback / TBD slots. */
function Monogram({ name, size }: { name: string; size: number }) {
  const letters = name === "TBD"
    ? "?"
    : name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase().slice(0, 2);

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
      aria-label={name}
    >
      {letters}
    </div>
  );
}

export function TeamLogo({ logoSlug, teamName, pickid, size = 32, byMykelUrl }: TeamLogoProps) {
  const [failed, setFailed] = useState(false);

  if (pickid === 0) {
    return <Monogram name="TBD" size={size} />;
  }

  if (failed || !byMykelUrl) {
    return <Monogram name={teamName} size={size} />;
  }

  return (
    <Image
      src={byMykelUrl}
      alt={teamName}
      width={size}
      height={size}
      style={{ borderRadius: 4, objectFit: "contain" }}
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}
