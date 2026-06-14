/**
 * Predictions parsing: read a `GetTournamentPredictions` response into typed,
 * normalized picks. This is the read half of the read/mirror pipeline.
 *
 * Pure parse logic lives in ./predictions-core (the verify harness imports it
 * directly under bare node — same split as layout-core / write-core). This
 * module owns the typed re-exports for app code.
 *
 * An empty picks array is normal pre-pick (handoff §0): the running app reads
 * live during the event.
 */

export {
  parsePredictions,
  type RawPrediction,
  type PredictionsEnvelope,
  type Prediction,
} from "./predictions-core";
