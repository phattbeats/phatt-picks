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
import type { ItemsEnvelope } from "./items";
import { buildUploadBody, type UploadPick } from "./write-core";

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
    public readonly responseBody?: string,
  ) {
    super(`${method} failed: ${status}${explain(status) ? ` — ${explain(status)}` : ""}`);
    this.name = "ValveApiError";
  }
}

/**
 * Redact a URLSearchParams or body string for log output — strips the values of
 * `key` (STEAM_API_KEY) and `steamidkey` (per-user auth code) so we can dump
 * the rest of the request shape without leaking secrets.
 */
function redactSecrets(body: string): string {
  return body
    .replace(/(^|&)key=[^&]*/g, "$1key=REDACTED")
    .replace(/(^|&)steamidkey=[^&]*/g, "$1steamidkey=REDACTED");
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

/**
 * Read a user's owned lockable tournament items. The `type:"team"` items carry
 * the itemids the write path must lock (handoff §5). itemids are bigints —
 * parsed bigint-safe (rule #2) so they stay strings end-to-end.
 */
export async function fetchTournamentItems(
  event: number,
  steamId: string,
  steamidkey: string,
): Promise<ItemsEnvelope> {
  const qs = new URLSearchParams({
    key: requireKey(),
    event: String(event),
    steamid: steamId,
    steamidkey,
  });
  const res = await fetch(`${BASE}/GetTournamentItems/v1/?${qs.toString()}`, {
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new ValveApiError(res.status, "GetTournamentItems");
  return parseSafeJson(text) as ItemsEnvelope;
}

/**
 * Write a batch of picks (a whole stage, or the whole playoff bracket) in one
 * indexed call (handoff §0.1/§8). Picks are sent as the documented 1-based
 * indexed params built by write-core; itemids go out as exact digit strings
 * (rule #2). On 200, returns the parsed envelope so the caller can adopt any
 * itemids Valve assigned. A non-200 throws ValveApiError carrying the status so
 * the caller can degrade (rule #7) — failures are surfaced, never silently
 * retried (rule #8).
 */
export async function uploadTournamentPredictions(
  event: number,
  steamId: string,
  steamidkey: string,
  picks: UploadPick[],
): Promise<PredictionsEnvelope> {
  const body = buildUploadBody(
    { key: requireKey(), event, steamid: steamId, steamidkey },
    picks,
  );
  const bodyStr = body.toString();
  const res = await fetch(`${BASE}/UploadTournamentPredictions/v1/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyStr,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    // PHA-853: surface the actual Valve response on non-200 so a live 400 in
    // docker logs has something to chase. Secrets are redacted; everything else
    // (sectionid/pickid/itemid/index shape) is exactly what Valve saw.
    console.error(
      "[valve] UploadTournamentPredictions failed",
      JSON.stringify({
        status: res.status,
        statusText: res.statusText,
        event,
        pickCount: picks.length,
        requestBody: redactSecrets(bodyStr),
        responseBody: text.slice(0, 2000),
      }),
    );
    throw new ValveApiError(res.status, "UploadTournamentPredictions", text);
  }
  return parseSafeJson(text) as PredictionsEnvelope;
}
