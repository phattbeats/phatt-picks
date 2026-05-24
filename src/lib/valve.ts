/**
 * Valve Steam Pick'Em API client — SERVER-SIDE ONLY.
 *
 * Reads the app `key` (STEAM_API_KEY) from the environment; that key and the
 * per-user `steamidkey` (auth code) must never reach the client. Only call
 * these from route handlers / server components. Every response that can carry
 * itemids is parsed with parseSafeJson so 17+ digit bigints stay strings (rule #2).
 *
 * Errors are surfaced, not swallowed (rule #8): a non-200 throws ValveApiError
 * carrying the status so callers can fall back to stored picks (rule #7) and
 * report what happened rather than silently retrying.
 */

import { parseSafeJson } from "./bigint";
import type { PredictionsEnvelope } from "./predictions";

const BASE = "https://api.steampowered.com/ICSGOTournaments_730";

/** Human-readable meaning for the status codes the Pick'Em API uses. */
function explain(status: number): string | undefined {
  return {
    400: "Bad Request — malformed params",
    401: "Unauthorized — key problem",
    403: "Forbidden — bad/expired auth code, or key not allowed for this call",
    404: "Not Found — event/section not open (or doesn't exist)",
    410: "Gone — picks for this matchup are locked (match started)",
    412: "Precondition Failed — pick conflicts with another bracket pick",
    429: "Too Many Requests — back off",
    503: "Service Unavailable — back off",
    504: "Gateway Timeout — backend slow; may have completed, re-query later",
  }[status];
}

export class ValveApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
  ) {
    super(`${method} failed: ${status}${explain(status) ? ` — ${explain(status)}` : ""}`);
    this.name = "ValveApiError";
  }
}

function requireKey(): string {
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error("STEAM_API_KEY not set — cannot call the Valve Pick'Em API");
  return key;
}

/**
 * Read a user's current Valve Pick'Em predictions for an event.
 * `steamidkey` is the per-user Game Authentication Code (distinct from the app key).
 */
export async function fetchTournamentPredictions(
  event: number,
  steamId: string,
  steamidkey: string,
): Promise<PredictionsEnvelope> {
  const qs = new URLSearchParams({
    key: requireKey(),
    event: String(event),
    steamid: steamId,
    steamidkey,
  });
  const res = await fetch(`${BASE}/GetTournamentPredictions/v1/?${qs.toString()}`, {
    cache: "no-store", // always read live during the event
  });
  const text = await res.text();
  if (!res.ok) throw new ValveApiError(res.status, "GetTournamentPredictions");
  // bigint-safe: itemids are 17+ digits and JSON.parse would corrupt them (rule #2).
  return parseSafeJson(text) as PredictionsEnvelope;
}
