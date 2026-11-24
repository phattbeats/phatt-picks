/**
 * A player's portrait (self-hosted /players/*.webp from the roster snapshot),
 * or his initial when there is none. Plain markup: usable from server and
 * client components alike.
 */
export function PlayerFace({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  if (!src) {
    return (
      <span className="fx-face none" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden>
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small self-hosted WebP, already sized
    <img className="fx-face" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" />
  );
}
