/**
 * Write-path core — PURE. No prisma, no network, no environment.
 *
 * Everything the upload path has to get *exactly right* lives here so the
 * verify script can exercise the same code the live write uses:
 *   - the indexed stage-batch param construction (handoff §0.1),
 *   - the playoff bracket ordering (QF → SF → GF, one ordered call),
 *   - itemid resolution carried as a digit string end-to-end (rule #2),
 *   - the 200-response → assigned-itemid extraction,
 *   - classifying a Valve failure as "degrade gracefully" vs "escalate" (rules #7/#8).
 *
 * Only value-imports ./bigint (also pure); the Prediction/PredictionsEnvelope
 * imports are type-only so this module runs under bare `node` (the verify path)
 * without dragging in the fixture-aliased predictions.ts. (Same trick the M4
 * pure cores use — see scoring.ts / outcomes-core.ts.)
 */

import type { PredictionsEnvelope } from "./predictions";

/**
 * Local digit-string guard (rule #2). Kept inline — with no runtime relative
 * imports — so this pure core stays loadable by the offline verify harness under
 * bare `node` (same constraint the M4 cores honor). Mirrors bigint.assertBigIntString.
 */
function assertDigitString(v: unknown, field: string): string {
  if (typeof v !== "string" || !/^\d+$/.test(v)) {
    throw new Error(`${field} must be a digit string, got: ${JSON.stringify(v)}`);
  }
  return v;
}

/** One pick destined for UploadTournamentPredictions. */
export interface UploadPick {
  sectionId: number;
  groupId: number;
  slotIndex: number; // the slot within the stage (the `index` param), 0-based
  pickId: number; // team pickid (== teamid in GetTournamentItems)
  itemId: string; // bigint digit string — REQUIRED to lock the sticker (rule #2)
}

/** A local Pick row, narrowed to the fields the write path consumes. */
export interface LocalPick {
  sectionId: number;
  groupId: number;
  slotIndex: number;
  pickId: number;
  itemId: string; // stored as a digit string (Pick.itemId); may be "" if unset
}

/** Playoff sections, in submission order (handoff §6: 108 QF, 109 SF, 110 GF). */
export const PLAYOFF_SECTION_IDS = [108, 109, 110] as const;

export function isPlayoffSection(sectionId: number): boolean {
  return (PLAYOFF_SECTION_IDS as readonly number[]).includes(sectionId);
}

/**
 * Resolve a stored local pick into an UploadPick, sourcing the itemid from the
 * freshly-fetched GetTournamentItems map keyed by teamid (handoff §5: "don't
 * invent the itemid — fetch it"). Falls back to the itemid already stored on the
 * Pick row if the live map lacks it. The result is always validated as a digit
 * string (rule #2) — a corrupted/short itemid throws here rather than silently
 * locking the wrong team on Valve.
 *
 * Throws on an unset (pickId 0) or unresolvable itemid: those are unexpected for
 * a pick the user explicitly made, so the caller escalates rather than uploads
 * garbage (rule #8).
 */
export function resolveUploadPick(
  pick: LocalPick,
  itemIdByTeam: Map<number, string>,
): UploadPick {
  if (!pick.pickId) {
    throw new Error(
      `cannot upload an unset pick (pickId 0) at section ${pick.sectionId} slot ${pick.slotIndex}`,
    );
  }
  const fromMap = itemIdByTeam.get(pick.pickId);
  const candidate = fromMap ?? (pick.itemId || undefined);
  if (!candidate) {
    throw new Error(
      `no itemid for team ${pick.pickId} (section ${pick.sectionId} slot ${pick.slotIndex}) — ` +
        `GetTournamentItems did not return it and none is stored`,
    );
  }
  return {
    sectionId: pick.sectionId,
    groupId: pick.groupId,
    slotIndex: pick.slotIndex,
    pickId: pick.pickId,
    itemId: assertDigitString(candidate, "itemid"), // rule #2: digit string only
  };
}

/**
 * Deterministic submission order for a batch: by section, then group, then slot.
 * Swiss stages are a single group so this is just slot order; the playoff bracket
 * relies on it for the QF(108) → SF(109) → GF(110) ordering (§0.1).
 */
export function orderPicks(picks: UploadPick[]): UploadPick[] {
  return [...picks].sort(
    (a, b) =>
      a.sectionId - b.sectionId ||
      a.groupId - b.groupId ||
      a.slotIndex - b.slotIndex,
  );
}

/**
 * Skip-unchanged key for a pick's current Steam state (PHA-928).
 *
 * MUST include groupId, not just slotIndex. The playoff bracket is multi-group
 * (QF 274–277, SF 278–279, GF 280) and every group has a single slot at index 0,
 * so a slot-only key collapses all seven picks onto one entry — the moment a
 * favorite advances QF→SF→GF (same team across groups) the SF/GF picks "match"
 * the QF's slot-0 entry and get silently dropped from the upload while the UI
 * reports them synced. Swiss is one group/section so the key happens to be
 * unique there too, but the bracket REQUIRES the group in the key.
 */
export function steamStateKey(groupId: number, slotIndex: number): string {
  return `${groupId}:${slotIndex}`;
}

/** Raw pick shape from GetTournamentPredictions. The live API uses `pick`
 * (not `pickid`) and omits `sectionid`, so the group+slot is all we can key on. */
export interface RawSteamPick {
  index?: number | string | null;
  groupid?: number | string | null;
  pick?: number | string | null;
  pickid?: number | string | null;
}

/**
 * Build the skip-unchanged map from the live Steam predictions, keyed by
 * group+slot across ALL groups in the response (PHA-928). The previous code
 * filtered to a single target groupId because sectionid is unavailable, but for
 * a multi-group playoff batch that dropped every group but the first. Keying by
 * group+slot makes the section irrelevant — the group disambiguates.
 */
export function buildSteamStateMap(rawPicks: RawSteamPick[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of rawPicks) {
    const slotIndex = Number(p.index);
    const groupId = Number(p.groupid);
    const pickId = Number(p.pick ?? p.pickid);
    if (
      !Number.isFinite(pickId) ||
      !Number.isFinite(slotIndex) ||
      !Number.isFinite(groupId) ||
      pickId === 0
    ) {
      continue;
    }
    out.set(steamStateKey(groupId, slotIndex), pickId);
  }
  return out;
}

/**
 * Partition resolved picks into those that must be uploaded vs those already
 * correctly set on Steam (skip-unchanged, PHA-875). A pick is "already synced"
 * only when the SAME group+slot already holds the SAME team — so a favorite
 * advancing across bracket groups is correctly uploaded to each group (PHA-928).
 */
export function partitionBySteamState(
  resolved: UploadPick[],
  steamState: Map<string, number>,
): { toUpload: UploadPick[]; alreadySynced: UploadPick[] } {
  const toUpload: UploadPick[] = [];
  const alreadySynced: UploadPick[] = [];
  for (const p of resolved) {
    if (steamState.get(steamStateKey(p.groupId, p.slotIndex)) === p.pickId) {
      alreadySynced.push(p);
    } else {
      toUpload.push(p);
    }
  }
  return { toUpload, alreadySynced };
}

/**
 * Build the form body for a SINGLE pick upload (PHA-853 live finding).
 *
 * PHA-826 §0.3 had two unconfirmed shapes: an indexed batch (`sectionid1…
 * sectionidN…`) and an unsuffixed single-pick call. The live Valve smoke
 * proved this endpoint only accepts the **unsuffixed single-pick** shape —
 * batching with indexed params returns 400 "Required parameter 'sectionid'
 * is missing". So Lock In is N sequential single-pick calls, matching what
 * the CS2 client does on each user click.
 *
 * itemid is written as the exact digit string (rule #2) — never Number()'d.
 */
export function buildUploadBody(
  auth: { key: string; event: number; steamid: string; steamidkey: string },
  pick: UploadPick,
): URLSearchParams {
  return new URLSearchParams({
    key: auth.key,
    event: String(auth.event),
    steamid: auth.steamid,
    steamidkey: auth.steamidkey,
    sectionid: String(pick.sectionId),
    groupid: String(pick.groupId),
    index: String(pick.slotIndex),
    pickid: String(pick.pickId),
    itemid: pick.itemId, // string straight through — rule #2
  });
}

/**
 * Extract Valve's assigned itemids from a successful upload response. The 200
 * body mirrors GetTournamentPredictions (`result.picks[]`); if Valve assigns a
 * different itemid than we sent we adopt it "going forward" (handoff §5/§8.4).
 * Returns a map keyed `sectionId:groupId:slotIndex` → assigned itemid string.
 * Parse the raw body with parseSafeJson BEFORE calling this (rule #2).
 */
export function parseAssignedItemIds(
  envelope: PredictionsEnvelope,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of envelope?.result?.picks ?? []) {
    const itemid = p.itemid;
    if (itemid === null || itemid === undefined || itemid === 0 || itemid === "0") continue;
    if (typeof itemid === "number") {
      // A bare number here means the body was JSON.parse'd without bigint safety.
      throw new WriteShapeError(
        `upload response itemid arrived as a number (${itemid}) — parse with parseSafeJson (rule #2)`,
      );
    }
    const key = `${Number(p.sectionid)}:${Number(p.groupid)}:${Number(p.index)}`;
    out.set(key, assertDigitString(itemid, "assigned itemid"));
  }
  return out;
}

/**
 * Unexpected-shape failure (rule #8): a 200 whose body we cannot make sense of.
 * Distinct from a Valve status code (those are handled by classifyWriteFailure).
 * The caller surfaces this and marks the work blocked rather than retrying.
 */
export class WriteShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteShapeError";
  }
}

export type FailureDisposition = "degrade" | "escalate";

/**
 * The documented Pick'Em write failures — each is a normal, expected condition
 * the user-facing flow degrades through (rule #7): keep the local pick, fall
 * back to read/mirror, never retry-storm.
 *   403 bad/expired auth code · 404 stage not open · 410 matchup locked ·
 *   412 bracket conflict · 429 rate-limited (back off) ·
 *   500/502/503/504 transient Valve server errors (back off, retry, keep local).
 *
 * PHA-853 live finding: Valve's tournament endpoint emits bare-body 500s under
 * write load — indistinguishable in practice from the 429 rate-limit wave. A
 * 5xx is Valve's server hiccuping, not our request being wrong, so it degrades
 * (keep the local pick, the in-call retry already had a go) rather than
 * escalating as if it were a code bug.
 */
const DEGRADABLE_STATUSES = new Set([403, 404, 410, 412, 429, 500, 502, 503, 504]);

/**
 * Classify a Valve HTTP status: an expected/documented failure degrades
 * gracefully (rule #7); anything else is unexpected and escalates (rule #8).
 * A thrown network/timeout error (no status) is treated as degradable by the
 * caller — "may have completed, re-query later" (§5), so we keep the local pick.
 */
export function classifyWriteFailure(status: number): FailureDisposition {
  return DEGRADABLE_STATUSES.has(status) ? "degrade" : "escalate";
}
