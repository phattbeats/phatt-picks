"use client";

/**
 * The keyring on a PHATT ID / Hotline profile (PHA-4505): up to three charms
 * hanging from a steel ring. Each shows a transparent still; hovering or
 * focusing one wakes a lazy-loaded 3D model that spins (charm-scene.ts, loaded
 * only then). Low-end devices (little memory, few cores, Save-Data, reduced
 * motion) and browsers without WebGL keep the still. Cosmetic only; a charm's
 * name is for screen readers, never how it was earned.
 */

import { useEffect, useRef, useState } from "react";
import type { CharmScene } from "./charm-scene";

export interface KeyringCharm {
  key: string;
  name: string;
  model: string;
  poster: string;
}

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

function Charm({ charm }: { charm: KeyringCharm }) {
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
    <li className="kr-slot">
      <span className="kr-thread" aria-hidden="true" />
      <span
        className={`kr-charm${ready ? " live" : ""}`}
        role="img"
        aria-label={charm.name}
        tabIndex={0}
        onPointerEnter={() => wake(true)}
        onPointerLeave={() => wake(false)}
        onFocus={() => wake(true)}
        onBlur={() => wake(false)}
        onPointerDown={() => wake(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={charm.poster} alt="" width={240} height={240} loading="lazy" decoding="async" />
        <span ref={host} className="kr-3d" />
      </span>
    </li>
  );
}

export function Keyring({ charms }: { charms: KeyringCharm[] }) {
  if (charms.length === 0) return null;
  return (
    <section className="pp-keyring" aria-label="Keyring">
      <span className="eyebrow">Keyring</span>
      <div className="kr-wrap">
        <svg className="kr-ring" viewBox="0 0 60 60" aria-hidden="true">
          <circle cx="30" cy="30" r="24" fill="none" stroke="url(#krsteel)" strokeWidth="5" />
          <defs>
            <linearGradient id="krsteel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f2f4f7" />
              <stop offset=".5" stopColor="#8d96a3" />
              <stop offset="1" stopColor="#d9dde3" />
            </linearGradient>
          </defs>
        </svg>
        <ul className="kr-row">
          {charms.map((c) => (
            <Charm key={c.key} charm={c} />
          ))}
        </ul>
      </div>
    </section>
  );
}
