/**
 * Self-sealed picks — the pure rules (no prisma, no `@/` alias, no fetch), so
 * scripts/verify-pick-lock.ts can import this under `node --experimental-strip-types`.
 *
 * Default visibility is unchanged: a player's calls for a stage stay hidden from
 * everyone else until the stage LOCKS (reveal-core). Sealing adds an opt-in on top:
 *
 *   - While a stage is still open, a player with a COMPLETE set of calls can SEAL
 *     them. Sealing is a commitment: HOTLINE refuses every further edit to that
 *     stage for that player (POST /api/picks → 409 picks_sealed).
 *   - At seal time they choose PUBLIC (everyone can see the calls right away,
 *     before the stage locks) or HIDDEN (under wraps until the stage locks, exactly
 *     like an unsealed player).
 *   - HIDDEN → PUBLIC is allowed later. PUBLIC → HIDDEN and unsealing are not:
 *     once calls have been shown they can't be taken back, so nobody can publish
 *     a set to sway the room and then quietly swap it.
 *
 * The playoffs are one pick'em stage (#1016/#1204): QF, SF and GF are filled and
 * locked together, so they are sealed together as ONE unit keyed on the
 * Quarterfinals section id. Every other section is its own unit.
 *
 * Steam-synced players: Valve stays the official record and they can still
 * change picks in the CS2 client. The Steam mirror must NOT overwrite a sealed
 * unit's picks on HOTLINE; when Valve's picks drift from the sealed set after
 * they had matched, the seal is flagged as changed in-game. That flag is shown on
 * the player's own view AND publicly next to a public seal (honesty).
 */

export type SealVisibility = "public" | "hidden";
export const SEAL_VISIBILITIES: readonly SealVisibility[] = ["public", "hidden"];

/** Playoff bracket sections (QF, SF, GF) — mirrors write-core / PLAYOFF_ROUNDS. */
export const PLAYOFF_SEAL_SECTIONS: readonly number[] = [108, 109, 110];
/** The seal unit id for the whole playoff bracket (the Quarterfinals). */
export const PLAYOFF_SEAL_UNIT = 108;

/** Which seal unit a section belongs to: playoffs collapse onto the QF id. */
export function sealUnitFor(sectionId: number): number {
  return PLAYOFF_SEAL_SECTIONS.includes(sectionId) ? PLAYOFF_SEAL_UNIT : sectionId;
}

/** Every section a seal unit covers. */
export function sectionsInUnit(unit: number): number[] {
  return unit === PLAYOFF_SEAL_UNIT ? [...PLAYOFF_SEAL_SECTIONS] : [unit];
}

/** Strict parse of an API-supplied visibility. */
export function parseVisibility(raw: unknown): SealVisibility | null {
  return raw === "public" || raw === "hidden" ? raw : null;
}

export interface SealLike {
  visibility: string;
}

/** Client-safe view of a seal (what the pages hand to components). */
export interface SealView {
  unit: number;
  visibility: SealVisibility;
  lockedAt: string; // ISO
  /** Valve's in-game picks changed away from the sealed set after matching it. */
  steamDiverged: boolean;
}

export function isPublicSeal(seal: SealLike | null | undefined): boolean {
  return seal?.visibility === "public";
}

export type SealRejection =
  | "stage_locked" // the stage's own window has closed — nothing left to seal
  | "incomplete" // not every slot in the unit has a call
  | "already_sealed"
  | "not_sealed"
  | "public_is_final" // public → hidden is refused
  | "seal_is_final" // unsealing is refused
  | "picks_sealed" // an edit to a sealed unit
  | "bad_visibility";

export type SealDecision = { ok: true; noop?: boolean } | { ok: false; reason: SealRejection; status: number };

const reject = (reason: SealRejection, status = 409): SealDecision => ({ ok: false, reason, status });

/**
 * May this player seal this unit now? Only while the stage is still writable
 * (the same gate POST /api/picks uses), only with every slot filled, only once.
 */
export function canSeal(input: {
  stageWritable: boolean;
  filled: number;
  total: number;
  existing: SealLike | null;
  visibility: unknown;
}): SealDecision {
  if (!parseVisibility(input.visibility)) return reject("bad_visibility", 400);
  if (input.existing) return reject("already_sealed");
  if (!input.stageWritable) return reject("stage_locked");
  if (input.total <= 0 || input.filled < input.total) return reject("incomplete");
  return { ok: true };
}

/**
 * Change an existing seal's visibility. hidden → public is allowed (any time —
 * even after the stage locks it's harmless, but the UI only offers it while
 * open); public → public / hidden → hidden are no-ops; public → hidden is refused.
 */
export function canChangeVisibility(existing: SealLike | null, next: unknown): SealDecision {
  const v = parseVisibility(next);
  if (!v) return reject("bad_visibility", 400);
  if (!existing) return reject("not_sealed", 404);
  if (existing.visibility === v) return { ok: true, noop: true };
  if (existing.visibility === "public" && v === "hidden") return reject("public_is_final");
  return { ok: true };
}

/** Unsealing is never allowed — a seal is a commitment. */
export function canUnseal(): SealDecision {
  return reject("seal_is_final");
}

/** Edits to a sealed unit are refused; an unsealed unit defers to the stage gate. */
export function canEditPicks(input: { stageWritable: boolean; sealed: boolean }): SealDecision {
  if (!input.stageWritable) return reject("stage_locked");
  if (input.sealed) return reject("picks_sealed");
  return { ok: true };
}

/**
 * THE visibility gate. A player's calls for a stage may be shown to a viewer iff
 * the stage is revealed for everyone (locked — reveal-core), or the viewer IS
 * that player, or the player sealed the stage PUBLIC. A hidden seal changes
 * nothing for other viewers.
 */
export function arePlayerPicksVisible(input: {
  stageRevealed: boolean;
  isSelf: boolean;
  seal: SealLike | null | undefined;
}): boolean {
  return input.stageRevealed || input.isSelf || isPublicSeal(input.seal);
}

/** Why a pick is visible — drives the "Sealed early · public" marker. */
export function visibilityReason(input: {
  stageRevealed: boolean;
  isSelf: boolean;
  seal: SealLike | null | undefined;
}): "stage" | "self" | "public-seal" | "hidden" {
  if (input.stageRevealed) return "stage";
  if (input.isSelf) return "self";
  if (isPublicSeal(input.seal)) return "public-seal";
  return "hidden";
}

/** Composite slot key shared by the mirror + divergence checks. */
export function slotKey(sectionId: number, groupId: number, slotIndex: number): string {
  return `${sectionId}:${groupId}:${slotIndex}`;
}

export interface SlotPick {
  sectionId: number;
  groupId: number;
  slotIndex: number;
  pickId: number;
}

/**
 * Split a Steam mirror batch: predictions for sealed units are NEVER written
 * (the sealed snapshot on HOTLINE stays authoritative); for each sealed unit
 * that Valve reported on, say whether Valve's picks match the sealed set.
 *
 * "Matches" = every non-zero Valve pick in the unit equals the sealed pick at the
 * same slot, and every sealed slot is present on Valve. A unit Valve says
 * nothing about is not reported (no evidence either way).
 */
export function partitionMirror<T extends SlotPick>(
  preds: T[],
  sealedUnits: ReadonlySet<number>,
  sealedSnapshot: ReadonlyMap<string, number>,
): { mirror: T[]; matchByUnit: Map<number, boolean> } {
  const mirror: T[] = [];
  const valveByUnit = new Map<number, Map<string, number>>();
  for (const p of preds) {
    const unit = sealUnitFor(p.sectionId);
    if (!sealedUnits.has(unit)) {
      mirror.push(p);
      continue;
    }
    const m = valveByUnit.get(unit) ?? new Map<string, number>();
    m.set(slotKey(p.sectionId, p.groupId, p.slotIndex), p.pickId);
    valveByUnit.set(unit, m);
  }
  const matchByUnit = new Map<number, boolean>();
  for (const [unit, valve] of valveByUnit) {
    const sectionIds = new Set(sectionsInUnit(unit));
    let matches = true;
    for (const [k, pickId] of valve) {
      if (pickId !== 0 && sealedSnapshot.get(k) !== pickId) matches = false;
    }
    for (const [k, pickId] of sealedSnapshot) {
      const sec = Number(k.split(":")[0]);
      if (!sectionIds.has(sec) || pickId === 0) continue;
      if (valve.get(k) !== pickId) matches = false;
    }
    matchByUnit.set(unit, matches);
  }
  return { mirror, matchByUnit };
}

export interface SteamSealState {
  steamMatchedAt: Date | null;
  steamDivergedAt: Date | null;
}

/**
 * Advance a seal's Steam state from one mirror observation. A divergence is only
 * flagged once Valve has been SEEN matching the sealed set — a seal made before
 * the picks were ever pushed to Steam just reads "not on Steam yet", not
 * "changed in-game". Matching again (e.g. after Lock in & sync re-pushes the
 * sealed set) clears the flag.
 */
export function nextSteamState(prev: SteamSealState, matches: boolean, now: Date): SteamSealState {
  if (matches) return { steamMatchedAt: now, steamDivergedAt: null };
  if (!prev.steamMatchedAt) return prev;
  return { steamMatchedAt: prev.steamMatchedAt, steamDivergedAt: prev.steamDivergedAt ?? now };
}

/** Seal-time Steam baseline: matched iff every sealed pick was already on Steam. */
export function initialSteamMatched(rows: { pickId: number; isLocal: boolean }[]): boolean {
  const placed = rows.filter((r) => r.pickId !== 0);
  return placed.length > 0 && placed.every((r) => !r.isLocal);
}

// ── Metrics (admin analytics) ─────────────────────────────────────────────

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface SealMetricInput {
  /** Players with ≥1 non-zero call in the unit. */
  playersWithPicks: number;
  seals: { initialVisibility: string; visibility: string; lockedAtMs: number }[];
  /** The unit's published lock instant, or null when unknown. */
  stageLockAtMs: number | null;
}

export interface SealMetric {
  players: number;
  sealed: number;
  /** % of players with picks who sealed (null when nobody has picks). */
  sealedPct: number | null;
  chosePublic: number;
  choseHidden: number;
  /** % of sealers who chose public at seal time. */
  publicPct: number | null;
  /** Hidden seals later switched to public. */
  converted: number;
  /** Median ms between sealing and the stage's lock (sealers before lock only). */
  medianLeadMs: number | null;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function sealMetrics(input: SealMetricInput): SealMetric {
  const sealed = input.seals.length;
  const chosePublic = input.seals.filter((s) => s.initialVisibility === "public").length;
  const choseHidden = sealed - chosePublic;
  const converted = input.seals.filter((s) => s.initialVisibility === "hidden" && s.visibility === "public").length;
  const leads =
    input.stageLockAtMs == null
      ? []
      : input.seals.map((s) => input.stageLockAtMs! - s.lockedAtMs).filter((ms) => ms >= 0);
  return {
    players: input.playersWithPicks,
    sealed,
    sealedPct: pct(sealed, input.playersWithPicks),
    chosePublic,
    choseHidden,
    publicPct: pct(chosePublic, sealed),
    converted,
    medianLeadMs: median(leads),
  };
}

/** "2d 4h" / "5h 12m" / "38m" — compact lead-time label. */
export function fmtLead(ms: number | null): string {
  if (ms == null) return "—";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
