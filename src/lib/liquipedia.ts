/**
 * Liquipedia MediaWiki API client (server-only) — outcome fallback source.
 *
 * Used only when the Valve oracle does not expose results. Liquipedia's API
 * terms are strict and we honor them literally:
 *   - Custom, descriptive User-Agent with a contact (REQUIRED — generic UAs
 *     are blocked).
 *   - Rate limit: `action=parse` ≤ 1 req / 30s; other actions ≤ 1 req / 2s.
 *     Enforced here by a process-wide min-interval gate.
 *   - `Accept-Encoding: gzip` requested (their terms ask clients to accept it).
 *   - Content is CC-BY-SA 3.0 — attribution travels with the data
 *     (see LIQUIPEDIA_ATTRIBUTION in outcomes-core).
 *
 * "Cache hard" lives one layer up in ingestOutcomes: resolved results are
 * immutable, so we only ever ask Liquipedia about still-unresolved stages.
 *
 * Importing this from a client component is a build error by design (it must
 * stay server-side; it carries the contact e-mail in the UA).
 */

import { parseSafeJson } from "./bigint";
import { prisma } from "./db";
import type { RawResolvedSlot } from "./outcomes-core";

const API_BASE = "https://liquipedia.net/counterstrike/api.php";

// Liquipedia requires a descriptive UA naming the app + a contact.
const USER_AGENT = "phaTT-Picks/1.0 (Cologne pickem companion; contact: brandon@phatt.tech)";

// Min interval between parse calls (their stricter bucket).
const PARSE_MIN_INTERVAL_MS = 30_000;

// Hard ceiling on a single parse fetch. Without it a stalled/black-holed
// connection (accepted SYN, no bytes) hangs for minutes; the on-read driver
// (PHA-866) defers this past the response, but an unbounded hang still leaks a
// connection and delays the next refresh. The throttle guarantees ≤1 call/30s, so
// a 10s cap is comfortably safe. Aborts as a TimeoutError → graceful source outage.
const PARSE_FETCH_TIMEOUT_MS = 10_000;

const SOURCE = "liquipedia";

export class LiquipediaApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "LiquipediaApiError";
  }
}

/** Raised when the persisted throttle would be violated by an immediate call. */
export class LiquipediaThrottledError extends Error {
  constructor(readonly waitMs: number) {
    super(`Liquipedia parse throttled — wait ${waitMs}ms`);
    this.name = "LiquipediaThrottledError";
  }
}

// Process-wide serializing gate: each parse waits until 30s after the previous.
// This handles back-to-back calls within one container; the DB-backed gate
// below catches restart-loops and multi-process deployments.
let parseGate: Promise<void> = Promise.resolve();
function throttleParse(): Promise<void> {
  const wait = parseGate;
  let release: () => void;
  parseGate = new Promise<void>((r) => (release = r));
  return wait.then(() => {
    setTimeout(() => release(), PARSE_MIN_INTERVAL_MS);
  });
}

/**
 * Persisted throttle (PHA-844). Reads the last-call timestamp from SourceState;
 * if the interval hasn't elapsed, throws LiquipediaThrottledError instead of
 * calling the API. Callers should treat this as "skip this tick, try later".
 */
async function checkPersistedThrottle(): Promise<void> {
  const row = await prisma.sourceState.findUnique({ where: { source: SOURCE } });
  if (!row) return;
  const elapsed = Date.now() - row.lastCallAt.getTime();
  if (elapsed < PARSE_MIN_INTERVAL_MS) {
    throw new LiquipediaThrottledError(PARSE_MIN_INTERVAL_MS - elapsed);
  }
}

/** Stamp the persisted throttle — called immediately before every network attempt. */
async function stampPersistedThrottle(): Promise<void> {
  const now = new Date();
  await prisma.sourceState.upsert({
    where: { source: SOURCE },
    update: { lastCallAt: now },
    create: { source: SOURCE, lastCallAt: now },
  });
}

/**
 * Fetch the parsed wikitext of a Liquipedia page via `action=parse`.
 * Rate-limited (persisted + in-process) and UA-stamped. Throws
 * LiquipediaThrottledError if the DB gate blocks the call, or
 * LiquipediaApiError on non-200.
 */
export async function liquipediaParse(page: string): Promise<string> {
  await checkPersistedThrottle();
  await throttleParse();
  await stampPersistedThrottle();

  const url =
    `${API_BASE}?action=parse&format=json&prop=wikitext` +
    `&page=${encodeURIComponent(page)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Encoding": "gzip",
      Accept: "application/json",
    },
    // Never cache at the fetch layer — caching policy is owned by ingestOutcomes.
    cache: "no-store",
    // Bound the call so a hung connection can't stall the request. Aborts as a
    // TimeoutError, which ingestOutcomes treats as a graceful source outage.
    signal: AbortSignal.timeout(PARSE_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new LiquipediaApiError(`Liquipedia parse failed for "${page}"`, res.status);
  }

  const json = parseSafeJson(await res.text()) as {
    parse?: { wikitext?: { "*"?: string } };
    error?: { info?: string };
  };

  if (json.error) {
    throw new LiquipediaApiError(json.error.info ?? "Liquipedia API error");
  }

  return json.parse?.wikitext?.["*"] ?? "";
}

/**
 * Map a Liquipedia tournament bracket page into resolved slots.
 *
 * The bracket→slot extraction is tournament-specific and depends on the live
 * page's match templates. Until IEM Cologne 2026 actually plays out (June
 * 2026) the bracket has no completed matches, so this yields []. The parser
 * contract: walk completed `{{Match|...|winner=N}}` templates, map each to
 * its (sectionId, groupId, slotIndex) via `slotMapper`, and emit the winning
 * team's layout pickid. Unresolved or unmappable matches are skipped.
 */
export async function fetchLiquipediaResults(
  page: string,
  slotMapper: (matchId: string, winnerTeam: string) => RawResolvedSlot | null
): Promise<RawResolvedSlot[]> {
  const wikitext = await liquipediaParse(page);
  const results: RawResolvedSlot[] = [];

  // Completed matches carry an explicit winner= field. Pre-tournament pages
  // have none, so this loop is empty until results exist.
  const matchRe = /\{\{Match\b([\s\S]*?)\}\}/g;
  for (const m of wikitext.matchAll(matchRe)) {
    const body = m[1];
    const idMatch = body.match(/\|\s*id\s*=\s*([^\n|]+)/);
    const winnerMatch = body.match(/\|\s*winner\s*=\s*([^\n|]+)/);
    if (!idMatch || !winnerMatch) continue; // not yet resolved
    const slot = slotMapper(idMatch[1].trim(), winnerMatch[1].trim());
    if (slot) results.push(slot);
  }

  return results;
}
