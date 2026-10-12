/* eslint-disable @next/next/no-img-element -- static brand PNGs from /public/brand; next/image adds nothing for a fixed-size logo. */

/**
 * HOTLINE brand marks — the official ticket-H symbol and horizontal lockup
 * (Singapore brand). Always rendered from the supplied artwork in
 * /public/brand, never re-typeset. The old crosshair mark + text wordmark are retired.
 */

/** Horizontal lockup (amber ticket + cream wordmark), sized by height. */
export function HotlineLockup({ height = 24, className }: { height?: number; className?: string }) {
  return (
    <img
      className={className ? `lockup ${className}` : "lockup"}
      src="/brand/lockup-on-dark-2x.png"
      alt="HOTLINE"
      width={Math.round((height * 2400) / 578)}
      height={height}
      style={{ height, width: "auto" }}
    />
  );
}

/** Standalone ticket-H symbol (amber by default). */
export function HeatMark({ size = 30, tone = "amber" }: { size?: number; tone?: "amber" | "white" }) {
  return (
    <img
      className="brand-symbol"
      src={`/brand/symbol-${tone}.png`}
      alt=""
      aria-hidden
      width={Math.round((size * 976) / 1024)}
      height={size}
      style={{ height: size, width: "auto" }}
    />
  );
}

/** Stacked lockup for hero moments. */
export function HotlineStacked({ height = 120 }: { height?: number }) {
  return (
    <img
      className="lockup"
      src="/brand/stacked-on-dark.png"
      alt="HOTLINE"
      width={Math.round((height * 1600) / 989)}
      height={height}
      style={{ height, width: "auto" }}
    />
  );
}

