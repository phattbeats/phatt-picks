"use client";

/**
 * usePickDraft — the one save engine behind the Swiss board and the playoff
 * bracket (PHA-5268). Every change is written to localStorage first, then
 * pushed to POST /api/picks as a debounced, single-flight diff against what the
 * server last confirmed. A transient failure keeps the pick on screen and in
 * the browser and retries with backoff (and on reconnect / tab focus); a
 * permanent refusal (stage locked, sealed, invalid) reverts to the server.
 * On mount a leftover draft is merged back over the server's picks.
 * Pure rules live in src/lib/pick-draft-core.ts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifySaveFailure,
  diffSlots,
  draftStorageKey,
  mergeDraft,
  readDraft,
  retryDelayMs,
  type PickDraft,
  type SlotMap,
} from "@/lib/pick-draft-core";

export type DraftStatus = "idle" | "saving" | "saved" | "retrying" | "error";

/** Push these changed slots; resolve ok, or reject with the HTTP status (null = no answer). */
export type SaveFn = (changed: string[], desired: SlotMap) => Promise<void>;

export class SaveError extends Error {
  constructor(public status: number | null) {
    super(status == null ? "network" : `HTTP ${status}`);
  }
}

const DEBOUNCE_MS = 200;
const SAVED_FLASH_MS = 1200;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // private mode / blocked storage — server save still runs
  }
}

export function usePickDraft({
  eventId,
  unit,
  owner,
  initial,
  enabled,
  save,
}: {
  eventId: number;
  unit: number | "playoff";
  /** Session player id; no owner = no browser draft (signed out). */
  owner: string | null | undefined;
  initial: SlotMap;
  enabled: boolean;
  save: SaveFn;
}) {
  const key = draftStorageKey(eventId, unit);
  const [picks, setPicksState] = useState<SlotMap>(initial);
  const [status, setStatus] = useState<DraftStatus>("idle");
  // Slots the server refused for good — the board flashes them, then reverts.
  const [rejected, setRejected] = useState<string[]>([]);

  const picksRef = useRef(picks);
  const savedRef = useRef<SlotMap>({ ...initial });
  // Render-side mirror of savedRef, so `pending` is derived from state.
  const [saved, setSaved] = useState<SlotMap>(initial);
  const inFlight = useRef(false);
  const attempt = useRef(0);
  const retryTimer = useRef<number | null>(null);
  // Bumped on every local change (and on a draft restore) — boards compare it
  // to the version they last synced to Steam to light the "not on Steam" hint.
  const [version, setVersion] = useState(0);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const writeDraft = useCallback(
    (desired: SlotMap) => {
      const ls = storage();
      if (!ls || !owner) return;
      try {
        if (diffSlots(desired, savedRef.current).length === 0) {
          ls.removeItem(key); // nothing pending — the server has it all
          return;
        }
        const d: PickDraft = { v: 1, owner, base: savedRef.current, picks: desired, savedAt: Date.now() };
        ls.setItem(key, JSON.stringify(d));
      } catch {
        /* quota / blocked — best effort */
      }
    },
    [key, owner],
  );

  const flush = useCallback(async () => {
    if (inFlight.current || !enabled) return;
    if (retryTimer.current != null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    const desired = picksRef.current;
    const changed = diffSlots(desired, savedRef.current);
    if (changed.length === 0) return;

    inFlight.current = true;
    setStatus("saving");
    let again = false;
    try {
      await saveRef.current(changed, desired);
      const confirmed = { ...savedRef.current };
      for (const k of changed) {
        if ((desired[k] ?? 0) > 0) confirmed[k] = desired[k];
        else delete confirmed[k];
      }
      savedRef.current = confirmed;
      setSaved(confirmed);
      attempt.current = 0;
      writeDraft(picksRef.current);
      again = diffSlots(picksRef.current, savedRef.current).length > 0;
      setStatus(again ? "saving" : "saved");
      if (!again) {
        window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), SAVED_FLASH_MS);
      }
    } catch (e) {
      const httpStatus = e instanceof SaveError ? e.status : null;
      if (classifySaveFailure(httpStatus) === "drop") {
        // The server will never take these — put the board back to what it holds.
        setRejected(changed);
        picksRef.current = { ...savedRef.current };
        setPicksState(picksRef.current);
        writeDraft(picksRef.current);
        attempt.current = 0;
        setStatus("error");
      } else {
        attempt.current += 1;
        setStatus("retrying");
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null;
          void flushRef.current();
        }, retryDelayMs(attempt.current));
      }
    } finally {
      inFlight.current = false;
    }
    if (again) void flushRef.current();
  }, [enabled, writeDraft]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Restore a leftover draft once, after hydration (localStorage is client-only).
  useEffect(() => {
    if (!enabled || !owner) return;
    const ls = storage();
    const draft = readDraft(ls?.getItem(key) ?? null, owner, Date.now());
    if (!draft) return;
    const merged = mergeDraft(savedRef.current, draft);
    if (diffSlots(merged, savedRef.current).length === 0) {
      ls?.removeItem(key);
      return;
    }
    picksRef.current = merged;
    setPicksState(merged);
    setVersion((v) => v + 1);
    writeDraft(merged);
    void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only restore
  }, []);

  // Retry immediately when the connection comes back or the tab regains focus.
  useEffect(() => {
    if (!enabled) return;
    const kick = () => {
      if (document.visibilityState === "visible") void flush();
    };
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", kick);
      if (retryTimer.current != null) window.clearTimeout(retryTimer.current);
    };
  }, [enabled, flush]);

  // Debounced push of each change.
  useEffect(() => {
    if (!enabled || diffSlots(picks, savedRef.current).length === 0) return;
    const t = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [picks, enabled, flush]);

  /** Set the desired picks: written to the browser now, pushed to the server shortly. */
  const setPicks = useCallback(
    (update: (prev: SlotMap) => SlotMap) => {
      const next = update(picksRef.current);
      if (next === picksRef.current) return;
      picksRef.current = next;
      setPicksState(next);
      setRejected([]);
      setVersion((v) => v + 1);
      writeDraft(next);
    },
    [writeDraft],
  );

  const pending = diffSlots(picks, saved);
  return { picks, setPicks, status, pending, rejected, version, retryNow: flush };
}
