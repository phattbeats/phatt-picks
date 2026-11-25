"use client";

/**
 * Spoiler-free mode (PHA-5495) — hides a Swiss stage's RESULTS so a player who
 * hasn't watched yet keeps the pre-result view.
 *
 * What it hides and what it doesn't (PHA-5495 revision): the viewer's own picks
 * are ALWAYS visible. That is the whole point of the mode — people open the page
 * to check what they picked. What gets masked is the outcome layer: the live
 * bracket, the W-L standings table, and each pick's confirm/record chrome
 * (the green/red bar, the +pts / ✕, the running W-L). The picks board itself
 * is rendered unmarked, not blurred.
 *
 * When it turns on by itself: the mode follows the stage lifecycle. It is ON
 * while the stage is underway (its first match has kicked off and not every
 * slot has resolved) and OFF once the stage is over - and OFF before the stage
 * starts, where there is nothing to spoil. The phase is computed on the server
 * (`phase`), so the automatic switch happens on the next render of the stage.
 *
 * The viewer's own toggle is kept per stage in localStorage, but it is scoped
 * to the phase it was made in (see spoiler-free-core): a choice made days ago
 * cannot quietly override the automatic switch-on when the stage starts.
 *
 * Server render and first client render both use the same default, so there is
 * no hydration mismatch. The stored choice is read through useSyncExternalStore,
 * which swaps it in on the client without a setState-in-effect.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  createStoredChoiceReader,
  resolveSpoilerState,
  serializeChoice,
  type SpoilerPhase,
  type StorageLike,
} from "@/lib/spoiler-free-core";

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
  phase,
  children,
}: {
  storageKey: string;
  /** The stage's lifecycle phase ("pre" | "live" | "done") - drives the default. */
  phase: SpoilerPhase;
  children: ReactNode;
}) {
  // The snapshot MUST be stable across calls: React's useSyncExternalStore
  // re-renders (and eventually throws error #185, blanking the page) if
  // getSnapshot hands back a new object every time. The reader memoises the
  // parse, so the same reference is returned until the stored string changes.
  const reader = useMemo(() => {
    let storage: StorageLike | null = null;
    try {
      // Accessing window.localStorage itself can throw (blocked cookies,
      // sandboxed iframe), not just the getItem call.
      storage = typeof window === "undefined" ? null : window.localStorage;
    } catch {
      storage = null;
    }
    return createStoredChoiceReader(storageKey, storage);
  }, [storageKey]);
  const stored = useSyncExternalStore(
    subscribeTo(storageKey),
    reader,
    () => null, // server snapshot: no storage, so the stage default renders
  );
  const { on } = resolveSpoilerState({ phase, stored });

  function toggle() {
    try {
      window.localStorage.setItem(
        storageKey,
        serializeChoice({ on: !on, phase }),
      );
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
            Results are hidden while this stage is in progress. Your picks stay
            visible — turn it off to see how they landed.
          </span>
        )}
      </div>
      <div className={on ? "sf-results sf-on" : "sf-results"}>{children}</div>
    </div>
  );
}
