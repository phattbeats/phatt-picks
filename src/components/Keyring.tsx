"use client";

/**
 * The keyring on a PHATT ID / Hotline profile (PHA-4505, rebuilt in PHA-5305):
 * up to three charms hanging from a steel ring. Each shows a transparent still;
 * hovering or focusing one wakes a lazy-loaded 3D model that spins
 * (charm-scene.ts, loaded only then). Low-end devices (little memory, few
 * cores, Save-Data, reduced motion) and browsers without WebGL keep the still.
 * Cosmetic only; a charm's name is for screen readers, never how it was earned.
 *
 * PHA-5305: the charms are toys. They hang on threads with real physics — pick
 * one up, swing it, let go, and it falls back and knocks the others around
 * (keyring-physics.ts). Charms you do not have yet are shown greyed out, so the
 * keyring reads as a collection with gaps rather than a row of what-you-own.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CHARM_ATTACHMENT } from "@/lib/keyring-attachments";
import type { CharmScene } from "./charm-scene";
import {
  DEFAULT_PHYSICS,
  FIXED_DT,
  makeBody,
  placeBody,
  step,
  throwBody,
  charmTopLeft,
  threadAngle,
  type CharmAttachment,
  type KeyringBody,
} from "./keyring-physics";

export interface KeyringCharm {
  key: string;
  name: string;
  model: string;
  poster: string;
  /** The metal loop in the poster, expressed as a fraction of its square. */
  attachment: CharmAttachment;
}

/** How many charms a keyring holds. */
export const KEYRING_SLOTS = 3;

let can3d: boolean | null = null;

function canRun3d(): boolean {
  if (can3d === null) can3d = probe3d();
  return can3d;
}

function probe3d(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (nav.connection?.saveData) return false;
  if ((nav.deviceMemory ?? 8) < 4 || (nav.hardwareConcurrency ?? 8) < 4) return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Charm({
  charm,
  register,
}: {
  charm: KeyringCharm;
  register: (key: string, el: HTMLSpanElement | null) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const scene = useRef<CharmScene | null>(null);
  const loading = useRef(false);
  const wanted = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  const wake = (on: boolean) => {
    wanted.current = on;
    if (!canRun3d()) return;
    if (scene.current) {
      scene.current.setActive(on);
      return;
    }
    if (!on || loading.current || !host.current) return;
    loading.current = true;
    import("./charm-scene")
      .then((m) => m.mountCharm(host.current!, charm.model, false))
      .then((s) => {
        if (!host.current) return s.dispose();
        scene.current = s;
        setReady(true);
        s.setActive(wanted.current);
      })
      .catch(() => {
        loading.current = false;
      });
  };

  return (
    <span
      ref={(el) => register(charm.key, el)}
      className={`kr-charm${ready ? " live" : ""}`}
      role="img"
      aria-label={charm.name}
      tabIndex={0}
      onPointerEnter={() => wake(true)}
      onPointerLeave={() => wake(false)}
      onFocus={() => wake(true)}
      onBlur={() => wake(false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={charm.poster} alt="" width={240} height={240} loading="lazy" decoding="async" />
      <span ref={host} className="kr-3d" />
    </span>
  );
}

/** A charm the player has not earned yet: greyed out, no life in it. */
function LockedCharm({ charm }: { charm: KeyringCharm }) {
  return (
    <li className="kr-locked-item">
      <span className="kr-charm locked" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={charm.poster} alt="" width={240} height={240} loading="lazy" decoding="async" />
      </span>
      <span className="sr-only">{charm.name} — not yet earned</span>
    </li>
  );
}

export function Keyring({ charms, locked = [] }: { charms: KeyringCharm[]; locked?: KeyringCharm[] }) {
  const stage = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGSVGElement>(null);
  const bodies = useRef<Map<string, KeyringBody>>(new Map());
  const nodes = useRef<Map<string, HTMLSpanElement>>(new Map());
  const threads = useRef<Map<string, SVGLineElement>>(new Map());
  const drag = useRef<{ key: string; dx: number; dy: number; lastX: number; lastY: number; lastT: number } | null>(null);
  // Physics is on unless the reader asked for less motion. A ref, not state:
  // the frame loop must never re-render the page.
  const live = useRef(false);

  const register = useCallback((key: string, el: HTMLSpanElement | null) => {
    if (el) nodes.current.set(key, el);
    else nodes.current.delete(key);
  }, []);

  const registerThread = useCallback((key: string, el: SVGLineElement | null) => {
    if (el) threads.current.set(key, el);
    else threads.current.delete(key);
  }, []);

  // Build the bodies from the ring's measured position. The charms hang from
  // points spread around the lower half of the ring, so they do not stack.
  const rebuild = useCallback(() => {
    const stageEl = stage.current;
    const ringEl = ring.current;
    if (!stageEl || !ringEl) return;
    const s = stageEl.getBoundingClientRect();
    const r = ringEl.getBoundingClientRect();
    const cx = r.left - s.left + r.width / 2;
    const cy = r.top - s.top + r.height / 2;
    const radius = r.width * 0.34;
    const n = Math.max(charms.length, 1);
    const spread = charms.length > 1 ? Math.PI * 0.62 : 0;
    const start = Math.PI / 2 - spread / 2;
    const next = new Map<string, KeyringBody>();
    charms.forEach((c, i) => {
      const angle = n === 1 ? Math.PI / 2 : start + (spread * i) / (n - 1);
      const ax = cx + Math.cos(angle) * radius;
      const ay = cy + Math.sin(angle) * radius;
      const prev = bodies.current.get(c.key);
      const len = 78;
      const body = makeBody(c.key, ax, ay, len, 34);
      if (prev) {
        // Keep where the charm already is, so a resize does not teleport it.
        body.x = prev.x;
        body.y = prev.y;
        body.ox = prev.ox;
        body.oy = prev.oy;
      }
      next.set(c.key, body);
    });
    bodies.current = next;
  }, [charms]);

  // The frame loop. Bodies are written straight to the DOM, never through
  // React state — this runs at 60fps and must not re-render the page.
  useEffect(() => {
    if (charms.length === 0) return;
    if (prefersReducedMotion()) return;

    live.current = true;
    rebuild();
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < 6) {
        step([...bodies.current.values()], FIXED_DT, DEFAULT_PHYSICS);
        acc -= FIXED_DT;
        steps++;
      }
      if (acc > FIXED_DT * 6) acc = 0;

      for (const [key, body] of bodies.current) {
        const el = nodes.current.get(key);
        if (el) {
          const tilt = threadAngle(body) * 0.35;
          const charm = charms.find((c) => c.key === key);
          const attachment = charm?.attachment ?? DEFAULT_CHARM_ATTACHMENT;
          const position = charmTopLeft(body, el.offsetWidth, el.offsetHeight, attachment);
          el.style.transformOrigin = `${attachment.x * 100}% ${attachment.y * 100}%`;
          el.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) rotate(${(tilt * 180) / Math.PI}deg)`;
        }
        const line = threads.current.get(key);
        if (line) {
          line.setAttribute("x1", String(body.ax));
          line.setAttribute("y1", String(body.ay));
          line.setAttribute("x2", String(body.x));
          line.setAttribute("y2", String(body.y));
        }
      }
    };
    raf = requestAnimationFrame(frame);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => rebuild()) : null;
    if (stage.current) ro?.observe(stage.current);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      live.current = false;
    };
  }, [charms, rebuild]);

  const localPoint = (e: React.PointerEvent) => {
    const s = stage.current?.getBoundingClientRect();
    if (!s) return { x: 0, y: 0 };
    return { x: e.clientX - s.left, y: e.clientY - s.top };
  };

  const onPointerDown = (e: React.PointerEvent, key: string) => {
    if (!live.current) return;
    const body = bodies.current.get(key);
    if (!body) return;
    const p = localPoint(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { key, dx: body.x - p.x, dy: body.y - p.y, lastX: p.x, lastY: p.y, lastT: e.timeStamp };
    body.grabbed = true;
    body.vx = 0;
    body.vy = 0;
    (e.currentTarget as HTMLElement).classList.add("dragging");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const body = bodies.current.get(d.key);
    if (!body) return;
    const p = localPoint(e);
    placeBody(body, p.x + d.dx, p.y + d.dy);
    const now = e.timeStamp;
    const dt = Math.max((now - d.lastT) / 1000, 1 / 240);
    const vx = (p.x - d.lastX) / dt;
    const vy = (p.y - d.lastY) / dt;
    body.vx = body.vx * 0.55 + vx * 0.45;
    body.vy = body.vy * 0.55 + vy * 0.45;
    d.lastX = p.x;
    d.lastY = p.y;
    d.lastT = now;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const body = bodies.current.get(d.key);
    (e.currentTarget as HTMLElement).classList.remove("dragging");
    if (!body) return;
    throwBody(body, FIXED_DT);
  };

  const emptySlots = Math.max(KEYRING_SLOTS - charms.length - locked.length, 0);

  if (charms.length === 0 && locked.length === 0) return null;

  return (
    <section className="pp-keyring" aria-label="Keyring">
      <span className="eyebrow">Keyring</span>

      {charms.length > 0 ? (
        <div className="kr-stage" ref={stage}>
          <svg className="kr-ring" viewBox="0 0 60 60" aria-hidden="true" ref={ring}>
            <circle cx="30" cy="30" r="24" fill="none" stroke="url(#krsteel)" strokeWidth="5" />
            <defs>
              <linearGradient id="krsteel" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#f2f4f7" />
                <stop offset=".5" stopColor="#8d96a3" />
                <stop offset="1" stopColor="#d9dde3" />
              </linearGradient>
            </defs>
          </svg>
          <svg className="kr-threads" aria-hidden="true">
            {charms.map((c) => (
              <line
                key={c.key}
                ref={(el) => registerThread(c.key, el)}
                x1="0"
                y1="0"
                x2="0"
                y2="0"
                stroke="url(#krthread)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ))}
            <defs>
              <linearGradient id="krthread" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#aab2bd" />
                <stop offset="1" stopColor="#6b7380" />
              </linearGradient>
            </defs>
          </svg>
          <div className="kr-field">
            {charms.map((c) => (
              <span
                key={c.key}
                className="kr-body"
                onPointerDown={(e) => onPointerDown(e, c.key)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <Charm charm={c} register={register} />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {(locked.length > 0 || emptySlots > 0) && (
        <ul className="kr-locked">
          {locked.map((c) => (
            <LockedCharm key={c.key} charm={c} />
          ))}
          {Array.from({ length: emptySlots }, (_, i) => (
            <li key={`empty-${i}`} className="kr-locked-item">
              <span className="kr-charm empty" aria-hidden="true" />
              <span className="sr-only">Empty keyring slot</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
