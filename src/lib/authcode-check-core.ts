/**
 * Auth-code save check: what a Valve answer means for a code the player just pasted.
 *
 * Pure (no network, no DB) so the rules are testable offline. The route runs the
 * Valve call and passes the outcome here.
 *
 * The rule that matters: ONLY a real 403 says "Valve does not accept this code".
 * Everything else (an outage, a 429, a 5xx, a Pick'Em that has not opened, a
 * network error) says nothing about the code, so the code is saved and the
 * player is told it could not be checked yet. Treating an outage as a bad code
 * would lock out every correct paste during one.
 */

export type CodeCheck =
  | { verdict: "accepted" }
  | { verdict: "rejected" }
  | { verdict: "unchecked"; reason: "pickem-not-open" | "valve-unavailable" | "event-archived" };

/** A Valve HTTP status (or null for a thrown network/timeout error) to a verdict. */
export function classifyCodeCheck(status: number | null): CodeCheck {
  if (status === null) return { verdict: "unchecked", reason: "valve-unavailable" };
  if (status >= 200 && status < 300) return { verdict: "accepted" };
  if (status === 403) return { verdict: "rejected" };
  // 404 is "Pick'Em for this event is not open yet", not a verdict on the code.
  if (status === 404) return { verdict: "unchecked", reason: "pickem-not-open" };
  return { verdict: "unchecked", reason: "valve-unavailable" };
}

/** What the save route answers. A rejected code is refused (nothing stored). */
export interface SaveAnswer {
  httpStatus: number;
  body: { ok: boolean; error?: string; hasAuthCode?: boolean; check: CodeCheck["verdict"]; checkReason?: string };
  /** Whether to write the code. */
  store: boolean;
}

export function answerForCheck(check: CodeCheck): SaveAnswer {
  if (check.verdict === "rejected") {
    return { httpStatus: 422, store: false, body: { ok: false, error: "code_rejected", check: "rejected" } };
  }
  if (check.verdict === "unchecked") {
    return { httpStatus: 200, store: true, body: { ok: true, hasAuthCode: true, check: "unchecked", checkReason: check.reason } };
  }
  return { httpStatus: 200, store: true, body: { ok: true, hasAuthCode: true, check: "accepted" } };
}

/**
 * The status the green line shows. "current" used to mean only "a code is stored
 * for this Major"; it now also needs Valve to have accepted it, or not to have
 * refused it. `rejected` (Valve answered 403 for the stored code) shows red.
 */
export type CodeState = "none" | "stale" | "current" | "rejected";

export function codeState(input: {
  hasCode: boolean;
  savedForCurrentEvent: boolean;
  valveRejected: boolean;
}): CodeState {
  if (!input.hasCode) return "none";
  if (!input.savedForCurrentEvent) return "stale";
  return input.valveRejected ? "rejected" : "current";
}
