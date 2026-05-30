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

/** One prediction as returned by GetTournamentPredictions / sent to upload. */
export interface RawPrediction {
  sectionid: number;
  groupid: number;
  index: number;
  pickid: number;
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
export function toItemIdString(itemid: RawPrediction["itemid"]): string | null {
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
 * Valve's GetTournamentPredictions response includes placeholder entries for
 * stages a user has touched but slots they haven't filled: those carry
 * `groupid` + `index` but no `sectionid` / `pickid`, which would coerce to
 * NaN and blow up downstream upserts (live PHA-853 finding — prisma errors
 * "Argument `sectionId` is missing" for slots Brandon's earlier 429-failed
 * uploads left as half-state). We drop them here and log the count once per
 * call so future divergence surfaces in logs.
 */
export function parsePredictions(envelope: PredictionsEnvelope): Prediction[] {
  const picks = envelope?.result?.picks ?? [];
  const out: Prediction[] = [];
  let dropped = 0;
  for (const p of picks) {
    const sectionId = Number(p.sectionid);
    const pickId = Number(p.pickid);
    const groupId = Number(p.groupid);
    const slotIndex = Number(p.index);
    if (
      !Number.isFinite(sectionId) ||
      !Number.isFinite(groupId) ||
      !Number.isFinite(slotIndex) ||
      !Number.isFinite(pickId)
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
