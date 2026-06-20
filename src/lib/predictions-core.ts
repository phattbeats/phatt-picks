/**
 * Predictions parsing — PURE. No fixture import, no next-path alias.
 *
 * Split out of predictions.ts so the verify harness can exercise the same
 * parsePredictions the live read uses, under bare `node`. (Same pattern as
 * layout-core.ts / write-core.ts.)
 *
 * Rule #2: itemids are 17+ digit bigints and MUST stay strings end-to-end —
 * the raw response is parsed with parseSafeJson upstream (valve.ts) before
 * reaching here, so itemids arrive as strings.
 */

/** Local digit-string guard kept inline — keeps this core loadable without
 * a relative `./bigint` import that next-path aliases away under bare node. */
function assertDigitString(v: unknown, field: string): string {
  if (typeof v !== "string" || !/^\d+$/.test(v)) {
    throw new Error(`${field} must be a digit string, got: ${JSON.stringify(v)}`);
  }
  return v;
}

/**
 * One prediction as returned by GetTournamentPredictions.
 *
 * PHA-875 finding: Valve's live API uses `pick` (not `pickid`) and omits
 * `sectionid` entirely. We accept both field names so old fixtures/tests keep
 * working, and callers supply a groupid→sectionid map to fill in the missing
 * sectionid from context.
 */
export interface RawPrediction {
  sectionid?: number | null;
  groupid: number;
  index: number;
  /** Live Valve API field — the team pickid. Takes precedence over `pickid`. */
  pick?: number | null;
  /** Legacy / upload-response field name kept for backwards compat. */
  pickid?: number | null;
  itemid?: string | number | null; // bigint — a string once safe-parsed
}

export interface PredictionsEnvelope {
  result: { picks?: RawPrediction[] };
}

/** Normalized prediction. itemId is a digit string (rule #2) or null if unlocked. */
export interface Prediction {
  sectionId: number;
  groupId: number;
  slotIndex: number;
  pickId: number;
  itemId: string | null;
}

/**
 * Coerce a raw itemid into a safe digit string.
 * Large itemids arrive as strings (via parseSafeJson) and pass straight through.
 * A bare JS number is a precision hazard — only a value still inside the safe
 * integer range is accepted; anything larger has already lost digits and is
 * rejected rather than silently mislocking an item.
 */
function toItemIdString(itemid: RawPrediction["itemid"]): string | null {
  if (itemid === null || itemid === undefined || itemid === 0 || itemid === "0") return null;
  if (typeof itemid === "string") return assertDigitString(itemid, "itemid");
  // typeof === "number"
  if (!Number.isSafeInteger(itemid)) {
    throw new Error(
      `itemid arrived as an unsafe number (${itemid}) — it lost precision before reaching ` +
        `parsePredictions. Parse the raw response with parseSafeJson (rule #2).`,
    );
  }
  return String(itemid);
}

/**
 * Normalize a predictions envelope into a flat, validated Prediction[].
 *
 * PHA-875: Valve's GetTournamentPredictions uses `pick` (not `pickid`) and
 * omits `sectionid`. Pass `sectionByGroup` (groupid → sectionid) so the parser
 * can reconstruct the sectionId from the groupId in the response.
 *
 * Entries missing both the pickId field AND a sectionByGroup lookup for their
 * groupid are still dropped and counted — those are genuinely unresolvable
 * placeholder slots.
 */
export function parsePredictions(
  envelope: PredictionsEnvelope,
  sectionByGroup?: Map<number, number>,
): Prediction[] {
  const picks = envelope?.result?.picks ?? [];
  const out: Prediction[] = [];
  let dropped = 0;
  for (const p of picks) {
    const groupId = Number(p.groupid);
    const slotIndex = Number(p.index);
    // Accept both `pick` (live Valve API) and `pickid` (legacy/upload-response).
    const pickId = Number(p.pick ?? p.pickid);
    // sectionid is absent in the live API — infer from groupid via caller-supplied map.
    const sectionId = Number.isFinite(Number(p.sectionid))
      ? Number(p.sectionid)
      : sectionByGroup?.get(groupId) ?? NaN;

    if (
      !Number.isFinite(sectionId) ||
      !Number.isFinite(groupId) ||
      !Number.isFinite(slotIndex) ||
      !Number.isFinite(pickId) ||
      pickId === 0
    ) {
      dropped++;
      continue;
    }
    out.push({
      sectionId,
      groupId,
      slotIndex,
      pickId,
      itemId: toItemIdString(p.itemid),
    });
  }
  if (dropped > 0) {
    console.warn(
      `[predictions] dropped ${dropped} placeholder entries with missing sectionid/pickid`,
    );
  }
  return out;
}
