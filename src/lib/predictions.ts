/**
 * Predictions parsing: read a `GetTournamentPredictions` response into typed,
 * normalized picks. This is the read half of the read/mirror pipeline.
 *
 * Pure parse logic lives in ./predictions-core (the verify harness imports it
 * directly under bare node — same split as layout-core / write-core). This
 * module owns the fixture wrapper and the typed re-exports for app code.
 *
 * An empty picks array is normal pre-pick (handoff §0): the running app reads
 * live during the event; the committed fixture is the (empty) snapshot.
 */

import predictionsFixture from "@/fixtures/cologne-predictions.json";
import {
  parsePredictions,
  type PredictionsEnvelope,
  type Prediction,
} from "./predictions-core";

export {
  parsePredictions,
  indexPredictionsByPick,
  toItemIdString,
  type RawPrediction,
  type PredictionsEnvelope,
  type Prediction,
} from "./predictions-core";

/**
 * The committed predictions snapshot. Empty pre-pick — kept so offline dev/tests
 * exercise the same parse path the live read uses; the running app fetches live.
 */
export function getCommittedPredictions(): Prediction[] {
  return parsePredictions(predictionsFixture as PredictionsEnvelope);
}
