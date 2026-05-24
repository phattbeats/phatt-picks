/**
 * Predictions parsing: read a `GetTournamentPredictions` response into typed,
 * normalized picks. This is the read half of the read/mirror pipeline.
 *
 * The owner's current Valve Pick'Em picks come back as `result.picks[]`, each
 * entry mirroring the upload shape: { sectionid, groupid, index, pickid, itemid }.
 * `itemid` is a 17+ digit bigint and MUST stay a string end-to-end (rule #2) —
 * always feed the raw response through parseSafeJson (see valve.ts) so the
 * itemid is already a string by the time it reaches here.
 *
 * An empty picks array is normal pre-pick (handoff §0): the running app reads
 * live during the event; the committed fixture is the (empty) snapshot.
 */

import { assertBigIntString } from "./bigint";
import predictionsFixture from "@/fixtures/cologne-predictions.json";

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
function toItemIdString(itemid: RawPrediction["itemid"]): string | null {
  if (itemid === null || itemid === undefined || itemid === 0 || itemid === "0") return null;
  if (typeof itemid === "string") return assertBigIntString(itemid, "itemid");
  // typeof === "number"
  if (!Number.isSafeInteger(itemid)) {
    throw new Error(
      `itemid arrived as an unsafe number (${itemid}) — it lost precision before reaching ` +
        `parsePredictions. Parse the raw response with parseSafeJson (rule #2).`,
    );
  }
  return String(itemid);
}

/** Normalize a predictions envelope into a flat, validated Prediction[]. */
export function parsePredictions(envelope: PredictionsEnvelope): Prediction[] {
  const picks = envelope?.result?.picks ?? [];
  return picks.map((p) => ({
    sectionId: Number(p.sectionid),
    groupId: Number(p.groupid),
    slotIndex: Number(p.index),
    pickId: Number(p.pickid),
    itemId: toItemIdString(p.itemid),
  }));
}

/**
 * Reshape predictions into the picks-page lookup: sectionId → groupId →
 * slotIndex → pickId. Matches the `myPicks` shape the picks screen renders.
 */
export function indexPredictionsByPick(
  preds: Prediction[],
): Record<number, Record<number, Record<number, number>>> {
  const out: Record<number, Record<number, Record<number, number>>> = {};
  for (const p of preds) {
    out[p.sectionId] ??= {};
    out[p.sectionId][p.groupId] ??= {};
    out[p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }
  return out;
}

/**
 * The committed predictions snapshot. Empty pre-pick — kept so offline dev/tests
 * exercise the same parse path the live read uses; the running app fetches live.
 */
export function getCommittedPredictions(): Prediction[] {
  return parsePredictions(predictionsFixture as PredictionsEnvelope);
}
