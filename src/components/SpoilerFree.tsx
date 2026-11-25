"use client";

/**
 * Spoiler-free mode (PHA-5495) — hides a Swiss stage's results so a player who
 * hasn't watched yet keeps the pre-result view.
 *
 * Default is ON while the stage is underway (`defaultOn`, computed on the server
 * as "not complete"), and OFF once the stage is over. The player can flip it
 * either way; that choice is stored per stage in localStorage and survives reloads.
 * Hidden = results blurred in place and the viewer's own ✓/✕ marks faded, so the
 * layout does not shift (blur/opacity only, never display:none).
 *
 * Server render and first client render both use `defaultOn`, so there is no
 * hydration mismatch. The stored choice is read through useSyncExternalStore,
 * which swaps it in on the client without a setState-in-effect.
 */

import { useSyncExternalStore, type ReactNode } from "react";

type Choice = "on" | "off" | null;

function readChoice(storageKey: string): Choice {
  try {
    const v = window.localStorage.getItem(storageKey);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null; // storage blocked (private mode): use the stage default
  }
}

// Subscribe to our own writes and to other tabs changing the same key.
function subscribeTo(storageKey: string) {
  return (notify: () => void) => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) notify();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("sf-change", notify);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sf-change", notify);
    };
  };
}

export function SpoilerFree({
  storageKey,
  defaultOn,
  children,
}: {
  storageKey: string;
  defaultOn: boolean;
  children: ReactNode;
}) {
  const stored = useSyncExternalStore(
    subscribeTo(storageKey),
    () => readChoice(storageKey),
    () => null, // server snapshot: no storage, so the stage default renders
  );
  const on = stored === null ? defaultOn : stored === "on";

  function toggle() {
    try {
      window.localStorage.setItem(storageKey, on ? "off" : "on");
    } catch {
      /* not persisted; the toggle still works for this visit only */
    }
    window.dispatchEvent(new Event("sf-change"));
  }

  return (
    <div className="sf-wrap">
      <div className="sf-bar">
        <button
          type="button"
          className={`sf-toggle${on ? " on" : ""}`}
          aria-pressed={on}
          onClick={toggle}
        >
          <span className="sf-dot" aria-hidden="true" />
          Spoiler-free {on ? "on" : "off"}
        </button>
        {on && (
          <span className="sf-note">
            Results are hidden while this stage is in progress. Turn it off to see how your picks landed.
          </span>
        )}
      </div>
      <div className={on ? "sf-results sf-on" : "sf-results"}>{children}</div>
    </div>
  );
}
