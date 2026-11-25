/**
 * spoiler-free-core - the pure rules behind the picks page's spoiler-free mode
 * (PHA-5495).
 *
 * Two things live here, both pure so they can be proved offline:
 *
 * 1. The STAGE PHASE. A stage moves pre -> live -> done. The mode switches ON
 *    when the stage starts (its first match has kicked off, i.e. the published
 *    lock time has passed) and back OFF once the stage is over. Before the
 *    stage starts there is nothing to spoil, so the mode stays out of the way.
 *
 * 2. The STORED CHOICE. The viewer's explicit toggle is kept per stage, but it
 *    is scoped to the phase it was made in. A choice made while the stage was
 *    live must not silently override the automatic behaviour once the stage
 *    ends, and a choice made before the stage started must not pre-empt the
 *    automatic switch-on when the stage kicks off. Scoping by phase is what
 *    makes "switch when the stage starts" true even for a returning viewer who
 *    flipped the toggle days ago.
 *
 * Storage format: JSON `{"on": true, "phase": "live"}` under a per-stage key.
 * Legacy values (the old bare "on"/"off" strings) are deliberately NOT
 * honoured - they carry no phase, so they cannot be scoped, and honouring them
 * would let an old choice undermine the automatic stage-start switch. They read
 * as "no stored choice" and the stage default applies.
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under node.
 */

export type SpoilerPhase = "pre" | "live" | "done";

/** A viewer's explicit toggle, scoped to the phase it was made in. */
export type StoredSpoilerChoice = {
  on: boolean;
  phase: SpoilerPhase;
};

/**
 * The stage's phase.
 *
 * - `pre`  - the stage has not started (or has no published start time yet).
 * - `live` - the stage has started and is not finished: the window where a
 *            spoiler actually exists.
 * - `done` - the stage is over: every slot resolved, results are fair game.
 */
export function spoilerPhase(input: {
  /** The stage's first match has kicked off. */
  stageStarted: boolean;
  /** Every slot of the stage has a resolved outcome. */
  stageComplete: boolean;
}): SpoilerPhase {
  if (input.stageComplete) return "done";
  if (input.stageStarted) return "live";
  return "pre";
}

/** The automatic default for a phase: on only while the stage is underway. */
export function defaultSpoilerFree(phase: SpoilerPhase): boolean {
  return phase === "live";
}

/**
 * Parse a stored choice. Returns null for anything that is not a well-formed
 * `{ on: boolean, phase: SpoilerPhase }` - including the legacy bare "on"/"off"
 * strings, which are dropped on purpose (see the file header).
 */
export function parseStoredChoice(raw: string | null): StoredSpoilerChoice | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Legacy bare "on"/"off" (or anything else unparseable): no phase, no scope.
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { on, phase } = parsed as { on?: unknown; phase?: unknown };
  if (typeof on !== "boolean") return null;
  if (phase !== "pre" && phase !== "live" && phase !== "done") return null;
  return { on, phase };
}

/** Serialise a choice for localStorage. */
export function serializeChoice(choice: StoredSpoilerChoice): string {
  return JSON.stringify(choice);
}

/**
 * The mode the page should render, given the stage phase and whatever the
 * viewer last chose.
 *
 * A stored choice only applies while the stage is in the SAME phase it was
 * made in; otherwise the phase default wins. That is what makes the automatic
 * switch on stage start stick.
 */
export function resolveSpoilerState(input: {
  phase: SpoilerPhase;
  stored: StoredSpoilerChoice | null;
}): { on: boolean; stored: StoredSpoilerChoice | null } {
  const fallback = defaultSpoilerFree(input.phase);
  if (input.stored && input.stored.phase === input.phase) {
    return { on: input.stored.on, stored: input.stored };
  }
  return { on: fallback, stored: null };
}

/** The bit of the Storage API this module needs (so tests can pass a fake). */
export interface StorageLike {
  getItem(key: string): string | null;
}

/**
 * A MEMOISED reader for the stored choice — the fix for React error #185.
 *
 * `useSyncExternalStore` requires `getSnapshot` to return a cached value: if it
 * returns a NEW object on every call, React sees the snapshot change during
 * its own render and throws "Maximum update depth exceeded" (#185), which
 * unmounts the whole subtree — the picks page goes blank the moment a choice
 * exists. Parsing the stored JSON into a fresh object per call is exactly that
 * bug, so the parse is memoised here: the value is rebuilt only when the raw
 * string actually changes, and the SAME reference is returned until then.
 *
 * `useSyncExternalStore` calls `getSnapshot` several times per render, so this
 * stability is what keeps the page alive.
 */
export function createStoredChoiceReader(
  storageKey: string,
  storage: StorageLike | null,
): () => StoredSpoilerChoice | null {
  let lastRaw: string | null | undefined = undefined;
  let lastValue: StoredSpoilerChoice | null = null;
  return () => {
    if (!storage) return null;
    let raw: string | null;
    try {
      raw = storage.getItem(storageKey);
    } catch {
      return null; // storage blocked (private mode): use the stage default
    }
    if (raw === lastRaw) return lastValue;
    lastRaw = raw;
    lastValue = parseStoredChoice(raw);
    return lastValue;
  };
}

