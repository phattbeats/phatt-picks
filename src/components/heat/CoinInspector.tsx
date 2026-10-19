"use client";

/**
 * Coin inspector (#1278). Tap a coin and a lightbox opens with the coin in real
 * 3D: WebGL, built from the same struck relief as the Blender renders, with
 * reflective tier metal, glossy enamel, a reeded edge and (diamond) cut stones
 * (coin-scene.ts, loaded only when a coin is opened). Drag to turn it, flick to
 * set it spinning, double-tap or Flip to toss it, scroll or pinch to zoom in on
 * the strike. The key light follows the pointer so the metal catches it.
 *
 * Without WebGL, or for a Major whose 3D maps haven't been built, it falls back
 * to the CSS coin: the rendered front and back faces on a reeded wall.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { coinArtSrc, coinBackSrc, coinMapPrefixes, type ChallengeCoin } from "@/lib/challenge-coin-core";
import type { CoinScene } from "./coin-scene";

/** Number of flat strips approximating the cylinder's reeded (ribbed) edge. */
const EDGE_SEGMENTS = 90;

export function CoinInspector({
  coin,
  onClose,
}: {
  coin: ChallengeCoin;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"loading" | "webgl" | "css">("loading");
  const [px, setPx] = useState(560);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CoinScene | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const lastTap = useRef(0);

  // Size the stage to the viewport: big enough to read the strike.
  useEffect(() => {
    const fit = () => setPx(Math.max(260, Math.min(760, window.innerWidth - 32, window.innerHeight - 230)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Build the WebGL coin; any failure (no WebGL, missing maps) drops to CSS.
  useEffect(() => {
    let cancelled = false;
    let scene: CoinScene | null = null;
    (async () => {
      try {
        const mod = await import("./coin-scene");
        if (cancelled || !canvasRef.current || !mod.webglAvailable()) throw new Error("no webgl");
        const reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        scene = mod.createCoinScene({ canvas: canvasRef.current, tier: coin.tier, reducedMotion: reduced, ...coinMapPrefixes(coin.slug, coin.tier) });
        sceneRef.current = scene;
        await scene.ready;
        if (!cancelled) setMode("webgl");
      } catch {
        scene?.dispose();
        sceneRef.current = null;
        if (!cancelled) setMode("css");
      }
    })();
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [coin.slug, coin.tier]);

  useEffect(() => {
    sceneRef.current?.resize(px);
  }, [px, mode]);

  // Keyboard: Esc closes; F/space flips; S spins; +/- zoom; R resets; arrows turn.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sc = sceneRef.current;
      if (e.key === "Escape") return onClose();
      if (!sc) return;
      if (e.key === "f" || e.key === " ") { e.preventDefault(); sc.flip(); }
      else if (e.key === "s") sc.spin();
      else if (e.key === "r") sc.reset();
      else if (e.key === "+" || e.key === "=") sc.zoom(0.85);
      else if (e.key === "-") sc.zoom(1 / 0.85);
      else if (e.key === "ArrowLeft") { sc.drag(-24, 0); sc.release(); }
      else if (e.key === "ArrowRight") { sc.drag(24, 0); sc.release(); }
      else if (e.key === "ArrowUp") { sc.drag(0, -24); sc.release(); }
      else if (e.key === "ArrowDown") { sc.drag(0, 24); sc.release(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sceneRef.current?.zoom(Math.exp(e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const now = performance.now();
      if (now - lastTap.current < 300) sceneRef.current?.flip();
      lastTap.current = now;
    }
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sc = sceneRef.current;
    if (!sc) return;
    const r = e.currentTarget.getBoundingClientRect();
    sc.aim(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) sc.zoom(pinch.current / d);
      pinch.current = d;
      return;
    }
    sc.drag(e.clientX - prev.x, e.clientY - prev.y);
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) sceneRef.current?.release();
  };

  const tree = (
    <div className="coin-inspect-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Inspect ${coin.name} challenge coin`}>
      <div className="coin-inspect-panel" onClick={(e) => e.stopPropagation()}>
        <button className="coin-inspect-close" onClick={onClose} aria-label="Close">×</button>

        {mode === "css" ? (
          <CssCoin coin={coin} />
        ) : (
          <div className="coin-inspect-gl" style={{ width: px, height: px }}>
            {mode === "loading" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="coin-inspect-poster" src={coinArtSrc(coin.slug, coin.tier)} alt="" />
            )}
            <canvas
              ref={canvasRef}
              className={`coin-inspect-canvas${mode === "webgl" ? " on" : ""}`}
              style={{ width: px, height: px }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              aria-label="Drag to turn the coin"
            />
          </div>
        )}

        <div className="coin-inspect-meta">
          <span className={`coin-collectible-tier ${coin.tier}`}>{coin.tier}</span>
          <span className="coin-inspect-name">{coin.name.replace(/\s+CS2 Major Championship$/i, "")}</span>
          {coin.finish != null && (
            <span className="coin-inspect-finish">
              Finished {coin.finish} of {coin.fieldSize}
            </span>
          )}
          {mode === "webgl" ? (
            <>
              <div className="coin-inspect-tools">
                <button type="button" onClick={() => sceneRef.current?.flip()}>Flip</button>
                <button type="button" onClick={() => sceneRef.current?.spin()}>Spin</button>
                <button type="button" onClick={() => sceneRef.current?.zoom(0.7)} aria-label="Zoom in">+</button>
                <button type="button" onClick={() => sceneRef.current?.zoom(1 / 0.7)} aria-label="Zoom out">−</button>
                <button type="button" onClick={() => sceneRef.current?.reset()}>Reset</button>
              </div>
              <span className="coin-inspect-hint">Drag to turn · flick to spin · double-tap to flip · scroll or pinch to zoom</span>
            </>
          ) : (
            <span className="coin-inspect-hint">{mode === "loading" ? "Striking the coin…" : "Drag to rotate"}</span>
          )}
        </div>
      </div>
    </div>
  );
  // Portal to <body> so the fixed-position lightbox escapes the coin case's
  // overflow + any transformed ancestor (which would otherwise clip the coin
  // to the card — #1274 "fix clipping"). Mirrors StageWrapped/SpotlightModal.
  return typeof document === "undefined" ? null : createPortal(tree, document.body);
}

/**
 * Fallback coin for browsers without WebGL (or a Major without 3D maps): the
 * rendered front and back faces on a CSS `preserve-3d` disc with a reeded wall.
 * Idles with a slow auto-spin; a drag takes over and a release coasts.
 */
function CssCoin({ coin }: { coin: ChallengeCoin }) {
  const DIAM = 300; // on-screen coin diameter (px)
  const THICK = 27; // coin thickness (px) — matches the render (0.15 R body + relief)
  // Rim sits flush at the disc edge (art is cropped to the disc, so the face
  // radius IS DIAM/2). Tuck 1px so the reeded wall hugs the face instead of
  // ringing it like an orbit.
  const radius = DIAM / 2 - 1;

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

  // Animation loop: idle auto-spin, or coast on released velocity. Under
  // prefers-reduced-motion the idle spin stands down; drag + coast still work.
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      if (!dragging.current) {
        if (Math.abs(vel.current) > 0.05) {
          rot.current.y += vel.current;
          vel.current *= 0.95; // friction
        } else if (!reduced) {
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
  // Tangential length of each rim strip; +2px overlap so the wall has no seams.
  const segLen = Math.ceil((2 * Math.PI * radius) / EDGE_SEGMENTS) + 2;

  return (
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
            <span className={`coin3d-shine ${coin.tier}`} aria-hidden="true" />
          </div>
          {/* Back face */}
          <div className="coin3d-face" style={{ transform: `rotateY(180deg) translateZ(${THICK / 2}px)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={back} alt="" width={DIAM} height={DIAM} draggable={false} />
            <span className={`coin3d-shine ${coin.tier}`} aria-hidden="true" />
          </div>
          {/* Reeded edge — a true cylinder wall about the coin's own (Z)
              axis: each strip stands vertically (height = thickness) at the
              rim and faces outward, so it reads as the coin's milled edge,
              not a ring orbiting it. */}
          {Array.from({ length: EDGE_SEGMENTS }).map((_, i) => (
            <div
              key={i}
              className={`coin3d-edge ${coin.tier}`}
              style={{
                width: THICK,
                height: segLen,
                transform: `translate(-50%, -50%) rotateZ(${(360 / EDGE_SEGMENTS) * i}deg) translateX(${radius}px) rotateY(90deg)`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Convenience: a shelf thumbnail that opens the inspector on tap. Singapore
 * skin: the coin sits still (no sheen loop) and lifts a hair on hover; `delay`
 * staggers its one-shot strike-in so a shelf lands coin by coin. Transform/
 * opacity only (no blur/backdrop-filter, #1269), off under reduced-motion.
 */
export function InspectableCoin({ coin, size = 112, delay = 0 }: { coin: ChallengeCoin; size?: number; delay?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="coin-collectible-trigger"
        onClick={() => setOpen(true)}
        title={`Inspect ${coin.name} — ${coin.tier}`}
      >
        <span
          className={`coin-shine ${coin.tier}`}
          style={{ ["--shimmer-delay" as string]: `${delay}s` } as React.CSSProperties}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coinArtSrc(coin.slug, coin.tier)} alt={`${coin.name} challenge coin (${coin.tier})`} width={size} height={size} />
        </span>
      </button>
      {open && <CoinInspector coin={coin} onClose={() => setOpen(false)} />}
    </>
  );
}
