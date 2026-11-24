"use client";

/**
 * Player photos on the Pick'Em team pool: OFF by default (Brandon, 2026-11-23:
 * "remove the guys, leave the big logos as is, make it a switch at the bottom
 * of the page"). The choice is per device (localStorage) and shared between
 * the pool cards and the switch through one tiny store, so flipping the switch
 * at the bottom of the page updates the cards above it at once.
 *
 * Server render and first client render are always "off", so there is no
 * hydration mismatch and no photo is downloaded unless the viewer turns it on.
 */

import { useSyncExternalStore } from "react";

const KEY = "hotline.poolPhotos";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function setPoolPhotos(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the switch still works for this page view */
    memory = on;
  }
  listeners.forEach((l) => l());
}

let memory: boolean | null = null;

function getSnapshot(): boolean {
  return memory ?? read();
}

/** True when the viewer has turned player photos on for the team pool. */
export function usePoolPhotos(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** The "Player photos" switch shown at the bottom of the picks page. */
export function PoolPhotoSwitch() {
  const on = usePoolPhotos();
  return (
    <div className="sgp-photoswitch">
      <label>
        <span className="lbl">Player photos</span>
        <button
          type="button"
          role="switch"
          aria-label="Player photos"
          aria-checked={on}
          className={`sw${on ? " on" : ""}`}
          onClick={() => setPoolPhotos(!on)}
        >
          <span className="knob" aria-hidden="true" />
        </button>
      </label>
    </div>
  );
}
