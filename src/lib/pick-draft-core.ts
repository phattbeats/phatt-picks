/**
 * Browser-side pick draft (pure core). Brandon, PHA-5268: "always save the
 * picks each time they put one in — not Steam save, browser saved", so a failed
 * HOTLINE save (connection drop, expired session, server hiccup) never loses a
 * call when the player browses away and comes back.
 *
 * Model: every board keeps a draft in localStorage of
 *   { base, picks }
 * where `picks` is what the player wants and `base` is the last state the
 * server confirmed. A slot is a pending local edit exactly when
 * picks[k] !== base[k]. On the next page load the draft is three-way merged
 * over the server's current picks: pending edits win, everything else takes
 * the server's value (so a Valve mirror that changed a slot the player didn't
 * touch is respected). The board then re-pushes whatever still differs.
 *
 * Slot keys are `${groupId}:${slotIndex}`; a value of 0 = empty / cleared.
 */

export type SlotMap = Record<string, number>;
export type PicksMap = Record<number, Record<number, number>>;

export interface PickDraft {
  v: 1;
  /** Session player the draft belongs to — a shared browser never leaks picks across accounts. */
  owner: string;
  base: SlotMap;
  picks: SlotMap;
  savedAt: number;
}

/** Drafts older than this are ignored on load (a stage lasts days, not weeks). */
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const draftStorageKey = (eventId: number, unit: number | "playoff") =>
  `hotline:pick-draft:v1:${eventId}:${unit}`;

export const slotKey = (groupId: number, slotIndex: number) => `${groupId}:${slotIndex}`;

function parseKey(k: string): [number, number] | null {
  const m = /^(\d+):(\d+)$/.exec(k);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Nested board map → flat slot map, dropping empty slots. */
export function flatten(picks: PicksMap): SlotMap {
  const out: SlotMap = {};
  for (const [g, slots] of Object.entries(picks)) {
    for (const [s, p] of Object.entries(slots ?? {})) {
      if (p > 0) out[slotKey(Number(g), Number(s))] = p;
    }
  }
  return out;
}

/** Flat slot map → nested board map, dropping empty slots. */
export function unflatten(flat: SlotMap): PicksMap {
  const out: PicksMap = {};
  for (const [k, p] of Object.entries(flat)) {
    const parsed = parseKey(k);
    if (!parsed || !(p > 0)) continue;
    const [g, s] = parsed;
    (out[g] ??= {})[s] = p;
  }
  return out;
}

/** Keys whose value differs between two slot maps (missing = 0). */
export function diffSlots(next: SlotMap, base: SlotMap): string[] {
  const keys = new Set([...Object.keys(next), ...Object.keys(base)]);
  return [...keys].filter((k) => (next[k] ?? 0) !== (base[k] ?? 0)).sort();
}

/**
 * Three-way merge of a stored draft over the server's current picks.
 * Pending local edits win; untouched slots follow the server. If that leaves a
 * team in two slots of one group (the server moved it while the edit was
 * pending), the local edit keeps it and the server's copy is cleared.
 */
export function mergeDraft(server: SlotMap, draft: Pick<PickDraft, "base" | "picks">): SlotMap {
  const pending = new Set(diffSlots(draft.picks, draft.base));
  const merged: SlotMap = { ...server };
  for (const k of pending) {
    const v = draft.picks[k] ?? 0;
    if (v > 0) merged[k] = v;
    else delete merged[k];
  }
  // One team per group: local edits win a collision.
  const owner = new Map<string, string>(); // `${group}|${team}` → key
  const keys = Object.keys(merged).sort((a, b) => Number(pending.has(b)) - Number(pending.has(a)));
  for (const k of keys) {
    const parsed = parseKey(k);
    if (!parsed) continue;
    const id = `${parsed[0]}|${merged[k]}`;
    if (owner.has(id)) delete merged[k];
    else owner.set(id, k);
  }
  return merged;
}

/**
 * Should a failed save keep the draft and retry, or give up and revert?
 * `status` null = the request never got an HTTP answer (offline, DNS, abort).
 *  - 400 (invalid pick) and 409 (stage locked / sealed / archived / not open)
 *    will never succeed → "drop": revert to the server and forget the edit.
 *  - Everything else — network, 401 (session lapsed; it lands after sign-in),
 *    408/429, 5xx — is transient → "retry", the draft stays in the browser.
 */
export function classifySaveFailure(status: number | null): "retry" | "drop" {
  if (status === 400 || status === 404 || status === 409 || status === 422) return "drop";
  return "retry";
}

/** Backoff for retry attempt n (1-based): 2s, 4s, 8s … capped at 60s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1));
}

/** Parse a stored draft; null when absent, malformed, foreign or stale. */
export function readDraft(raw: string | null, owner: string, now: number): PickDraft | null {
  if (!raw || !owner) return null;
  try {
    const d = JSON.parse(raw) as Partial<PickDraft>;
    if (d?.v !== 1 || d.owner !== owner) return null;
    if (typeof d.savedAt !== "number" || now - d.savedAt > DRAFT_MAX_AGE_MS) return null;
    const clean = (m: unknown): SlotMap => {
      const out: SlotMap = {};
      if (m && typeof m === "object") {
        for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
          if (parseKey(k) && typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
        }
      }
      return out;
    };
    return { v: 1, owner, base: clean(d.base), picks: clean(d.picks), savedAt: d.savedAt };
  } catch {
    return null;
  }
}
