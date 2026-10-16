"use client";

/**
 * Client store for coach marks: the persisted TipsState (localStorage) plus
 * the "one bubble at a time" arbiter. Every <CoachMark> whose anchor is on
 * screen CLAIMS a slot with its order; only the lowest order is active. When it
 * is dismissed it releases and the next claimant appears — that's the
 * sequencing. Module-level so the settings row and the bubbles share it.
 */

import { useSyncExternalStore } from "react";
import {
  EMPTY_TIPS_STATE,
  LEGACY_VISIT_KEYS,
  LEGACY_VISIT_PREFIX,
  TIPS_STORAGE_KEY,
  markSeen,
  parseTipsState,
  resetTips,
  resolveAudience,
  serializeTipsState,
  type TipsState,
} from "@/lib/coach-core";

export interface CoachSnapshot {
  state: TipsState;
  /** true once the store has read storage and the page has settled. */
  ready: boolean;
  activeId: string | null;
}

/** Let the page (and any splash / entry animation) settle before bubbling. */
const SETTLE_MS = 900;

const SERVER_SNAPSHOT: CoachSnapshot = { state: EMPTY_TIPS_STATE, ready: false, activeId: null };

let snap: CoachSnapshot = SERVER_SNAPSHOT;
let initialised = false;
const listeners = new Set<() => void>();
const claims = new Map<string, number>();

function emit(next: Partial<CoachSnapshot>) {
  snap = { ...snap, ...next };
  for (const l of listeners) l();
}

function pickActive(): string | null {
  let best: string | null = null;
  let bestOrder = Infinity;
  for (const [id, order] of claims) {
    if (order < bestOrder) {
      best = id;
      bestOrder = order;
    }
  }
  return best;
}

function persist(state: TipsState) {
  try {
    localStorage.setItem(TIPS_STORAGE_KEY, serializeTipsState(state));
  } catch {
    /* storage blocked — tips still work for this page view */
  }
}

function hasLegacyVisit(): boolean {
  try {
    if (LEGACY_VISIT_KEYS.some((k) => localStorage.getItem(k) !== null)) return true;
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith(LEGACY_VISIT_PREFIX)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function readStored(): TipsState {
  try {
    return parseTipsState(localStorage.getItem(TIPS_STORAGE_KEY));
  } catch {
    return parseTipsState(null);
  }
}

function setState(state: TipsState) {
  persist(state);
  emit({ state });
}

export const coachStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: () => snap,
  getServerSnapshot: () => SERVER_SNAPSHOT,

  /** Called once by the app-layout host. Decides + persists the audience. */
  init(accountCreatedAtMs: number | null) {
    if (initialised || typeof window === "undefined") return;
    initialised = true;
    const stored = readStored();
    // Must run BEFORE we write our own key, which itself isn't a legacy trace.
    const aud = resolveAudience({ stored: stored.aud, accountCreatedAtMs, hasLegacyVisit: hasLegacyVisit() });
    const state = { ...stored, aud };
    persist(state);
    emit({ state });
    window.setTimeout(() => emit({ ready: true }), SETTLE_MS);
    // Another tab dismissed / reset → follow it.
    window.addEventListener("storage", (e) => {
      if (e.key === TIPS_STORAGE_KEY) emit({ state: { ...readStored(), aud: snap.state.aud ?? aud } });
    });
  },

  claim(id: string, order: number) {
    if (claims.get(id) === order) return;
    claims.set(id, order);
    const activeId = pickActive();
    if (activeId !== snap.activeId) emit({ activeId });
  },
  release(id: string) {
    if (!claims.delete(id)) return;
    const activeId = pickActive();
    if (activeId !== snap.activeId) emit({ activeId });
  },

  dismiss(id: string) {
    claims.delete(id);
    persist(markSeen(snap.state, id));
    emit({ state: markSeen(snap.state, id), activeId: pickActive() });
  },
  turnOff() {
    claims.clear();
    persist({ ...snap.state, off: true });
    emit({ state: { ...snap.state, off: true }, activeId: null });
  },
  setOff(off: boolean) {
    if (off) coachStore.turnOff();
    else setState({ ...snap.state, off: false });
  },
  reset() {
    setState(resetTips(snap.state));
  },
};

export function useCoach(): CoachSnapshot {
  return useSyncExternalStore(coachStore.subscribe, coachStore.getSnapshot, coachStore.getServerSnapshot);
}
