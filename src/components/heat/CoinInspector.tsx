"use client";

/**
 * Coin inspector (PHA-1278) — Brandon: "the user should be able to inspect and
 * drag rotate them." Tap a coin → a lightbox opens with a real 3D coin you spin
 * with a drag (pointer or touch): front face, struck reverse, and a knurled edge
 * ring, all in CSS `preserve-3d` (no WebGL). Idles with a slow auto-spin so it
 * reads as a physical object; grabbing it takes over, releasing hands it back.
 *
 * The faces are the same pre-rendered metal art shown on the shelf, so the
 * inspect view and the shelf thumbnail are always the identical coin.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { coinArtSrc, coinBackSrc, type ChallengeCoin } from "@/lib/challenge-coin-core";

/** Number of flat strips approximating the cylinder's knurled edge. */
const EDGE_SEGMENTS = 64;

export function CoinInspector({
  coin,
  onClose,
}: {
  coin: ChallengeCoin;
  onClose: () => void;
}) {
  const DIAM = 300; // on-screen coin diameter (px)
  const THICK = 22; // coin thickness (px)
  const radius = DIAM / 2;

  const rot = useRef({ x: -12, y: 0 });
  const vel = useRef(0); // residual spin velocity (deg/frame)
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const coinRef = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);

  const apply = useCallback(() => {
    const el = coinRef.current;
    if (el) el.style.transform = `rotateX(${rot.current.x}deg) rotateY(${rot.current.y}deg)`;
  }, []);

  // Animation loop: idle auto-spin, or coast on released velocity.
  useEffect(() => {
    const tick = () => {
      if (!dragging.current) {
        if (Math.abs(vel.current) > 0.05) {
          rot.current.y += vel.current;
          vel.current *= 0.95; // friction
        } else {
          rot.current.y += 0.25; // gentle idle spin
        }
        apply();
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [apply]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onDown = (e: React.PointerEvent) => {
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
    vel.current = 0;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    rot.current.y += dx * 0.6;
    rot.current.x = Math.max(-55, Math.min(55, rot.current.x - dy * 0.5));
    vel.current = dx * 0.6;
    apply();
  };
  const onUp = () => {
    dragging.current = false;
  };

  const front = coinArtSrc(coin.slug, coin.tier);
  const back = coinBackSrc(coin.tier);
  const segW = Math.ceil((Math.PI * DIAM) / EDGE_SEGMENTS) + 2;

  return (
    <div className="coin-inspect-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Inspect ${coin.name} challenge coin`}>
      <div className="coin-inspect-panel" onClick={(e) => e.stopPropagation()}>
        <button className="coin-inspect-close" onClick={onClose} aria-label="Close">×</button>

        <div className="coin-inspect-stage">
          <div
            className="coin-inspect-grab"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={{ width: DIAM, height: DIAM }}
          >
            <div
              ref={coinRef}
              className="coin3d"
              style={{ width: DIAM, height: DIAM, transform: "rotateX(-12deg) rotateY(0deg)" }}
            >
              {/* Front face */}
              <div className="coin3d-face" style={{ transform: `translateZ(${THICK / 2}px)` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={front} alt="" width={DIAM} height={DIAM} draggable={false} />
              </div>
              {/* Back face */}
              <div className="coin3d-face" style={{ transform: `rotateY(180deg) translateZ(${THICK / 2}px)` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={back} alt="" width={DIAM} height={DIAM} draggable={false} />
              </div>
              {/* Knurled edge ring */}
              {Array.from({ length: EDGE_SEGMENTS }).map((_, i) => (
                <div
                  key={i}
                  className={`coin3d-edge ${coin.tier}`}
                  style={{
                    width: segW,
                    height: THICK,
                    transform: `translate(-50%, -50%) rotateY(${(360 / EDGE_SEGMENTS) * i}deg) translateZ(${radius}px)`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="coin-inspect-meta">
          <span className={`coin-collectible-tier ${coin.tier}`}>{coin.tier}</span>
          <span className="coin-inspect-name">{coin.name}</span>
          {coin.finish != null && (
            <span className="coin-inspect-finish">
              Finished {coin.finish} of {coin.fieldSize}
            </span>
          )}
          <span className="coin-inspect-hint">drag to rotate</span>
        </div>
      </div>
    </div>
  );
}

/** Convenience: a shelf thumbnail that opens the inspector on tap. */
export function InspectableCoin({ coin, size = 112 }: { coin: ChallengeCoin; size?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="coin-collectible-trigger"
        onClick={() => setOpen(true)}
        title={`Inspect ${coin.name} — ${coin.tier}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coinArtSrc(coin.slug, coin.tier)} alt={`${coin.name} challenge coin (${coin.tier})`} width={size} height={size} />
      </button>
      {open && <CoinInspector coin={coin} onClose={() => setOpen(false)} />}
    </>
  );
}
