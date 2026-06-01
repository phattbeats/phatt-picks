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
  // PHA-875 diagnostic: log raw response to see full structure (remove once confirmed).
  console.info("[valve] GetTournamentPredictions raw:", text.slice(0, 3000));
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

/** Outcome of a single pick upload — used by the per-pick loop. */
export interface SinglePickResult {
  pick: UploadPick;
  ok: boolean;
  status: number;
  /** Parsed body when ok===true; raw text snippet otherwise. */
  envelope?: PredictionsEnvelope;
  errorBody?: string;
}

/**
 * Upload ONE pick (PHA-853 live finding: Valve rejects the batched/indexed shape
 * with 400 "Required parameter 'sectionid' is missing"; only single-pick calls
 * work). Returns a SinglePickResult — never throws on a non-200, so the caller
 * can keep going and aggregate.
 */
async function uploadSinglePick(
  event: number,
  steamId: string,
  steamidkey: string,
  pick: UploadPick,
): Promise<SinglePickResult> {
  const body = buildUploadBody(
    { key: requireKey(), event, steamid: steamId, steamidkey },
    pick,
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
    console.error(
      "[valve] UploadTournamentPredictions failed",
      JSON.stringify({
        status: res.status,
        statusText: res.statusText,
        event,
        pick: {
          sectionId: pick.sectionId,
          groupId: pick.groupId,
          slotIndex: pick.slotIndex,
          pickId: pick.pickId,
        },
        requestBody: redactSecrets(bodyStr),
        responseBody: text.slice(0, 2000),
      }),
    );
    return { pick, ok: false, status: res.status, errorBody: text.slice(0, 500) };
  }
  let envelope: PredictionsEnvelope;
  try {
    envelope = parseSafeJson(text) as PredictionsEnvelope;
  } catch (e) {
    console.error(
      "[valve] UploadTournamentPredictions 200 but unparseable body",
      JSON.stringify({ event, pick, error: e instanceof Error ? e.message : String(e) }),
    );
    return { pick, ok: false, status: res.status, errorBody: text.slice(0, 500) };
  }
  return { pick, ok: true, status: res.status, envelope };
}

/**
 * Spacing between consecutive single-pick uploads. Live smoke (PHA-853) showed
 * Valve's tournament endpoint 429s when hammered: first request 200, then
 * 429s in tight succession, and a single 200 leaks through after ~600ms when
 * the token bucket refills. 1500ms is a conservative cap that keeps a full
 * 10-pick Swiss stage at ~15s — slow but within mobile-tap patience.
 */
const PICK_UPLOAD_DELAY_MS = 1500;

/**
 * Extra wait before retrying a transient failure. The token bucket needs more
 * headroom than the normal cadence when it just refused us, and Steam's
 * `Retry-After` is rarely populated for this endpoint.
 */
const RETRY_DELAY_MS = 3500;

/**
 * Statuses that are worth retrying within the same Lock In — Valve's tournament
 * endpoint returns these transiently under load (PHA-853 live: 429 first, then
 * a wave of bare-body 500s on a partial edit). All are server-side / rate
 * conditions, not a problem with our request, so a backoff-and-retry is the
 * right move rather than failing the pick outright.
 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** How many times to re-attempt a single transient-failed pick. */
const MAX_RETRIES = 2;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Upload a batch of picks (a whole Swiss stage, or the whole playoff bracket)
 * as N sequential single-pick calls (PHA-853 — Valve only accepts the
 * unsuffixed single-pick shape; indexed batch returns 400). Throttled with a
 * {@link PICK_UPLOAD_DELAY_MS} pause between picks; a transient failure
 * ({@link RETRYABLE_STATUSES}) backs off {@link RETRY_DELAY_MS} and retries up
 * to {@link MAX_RETRIES} times. Anything still failing is surfaced per-pick so a
 * partial-success doesn't lose data.
 */
export async function uploadTournamentPredictions(
  event: number,
  steamId: string,
  steamidkey: string,
  picks: UploadPick[],
): Promise<SinglePickResult[]> {
  const out: SinglePickResult[] = [];
  for (let i = 0; i < picks.length; i++) {
    if (i > 0) await sleep(PICK_UPLOAD_DELAY_MS);
    let result = await uploadSinglePick(event, steamId, steamidkey, picks[i]);
    for (
      let attempt = 0;
      attempt < MAX_RETRIES && !result.ok && RETRYABLE_STATUSES.has(result.status);
      attempt++
    ) {
      await sleep(RETRY_DELAY_MS);
      result = await uploadSinglePick(event, steamId, steamidkey, picks[i]);
    }
    out.push(result);
  }
  return out;
}
