/** Reticle logomark. Corner-bracket frame + crosshair + center dot. */
export function HeatMark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="mark"
      style={{ width: size, height: size, display: "inline-block", filter: "drop-shadow(0 0 8px var(--heat-glow))" }}
      aria-hidden
    >
      <svg viewBox="0 0 64 64">
        <path className="stroke" d="M 6 18 L 6 6 L 18 6" strokeWidth={4} />
        <path className="stroke" d="M 46 6 L 58 6 L 58 18" strokeWidth={4} />
        <path className="stroke" d="M 58 46 L 58 58 L 46 58" strokeWidth={4} />
        <path className="stroke" d="M 18 58 L 6 58 L 6 46" strokeWidth={4} />
        <circle className="stroke" cx={32} cy={32} r={13} strokeWidth={4} />
        <line className="stroke" x1={6} y1={32} x2={17} y2={32} strokeWidth={3} />
        <line className="stroke" x1={47} y1={32} x2={58} y2={32} strokeWidth={3} />
        <circle className="dot" cx={32} cy={32} r={3.6} />
      </svg>
    </span>
  );
}

/** Wordmark "HOTLINE" with foil sheen on "LINE". */
export function HeatWordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      HOT
      <span className="foil">
        <span className="lj">L</span>INE
      </span>
    </span>
  );
}
