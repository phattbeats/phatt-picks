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
import type { RawResolvedSlot } from "./outcomes-core";

const API_BASE = "https://liquipedia.net/counterstrike/api.php";

// Liquipedia requires a descriptive UA naming the app + a contact.
const USER_AGENT = "phaTT-Picks/1.0 (Cologne pickem companion; contact: brandon@phatt.tech)";

// Min interval between parse calls (their stricter bucket).
const PARSE_MIN_INTERVAL_MS = 30_000;

export class LiquipediaApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "LiquipediaApiError";
  }
}

// Process-wide serializing gate: each parse waits until 30s after the previous.
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
 * Fetch the parsed wikitext of a Liquipedia page via `action=parse`.
 * Rate-limited and UA-stamped. Throws LiquipediaApiError on non-200.
 */
export async function liquipediaParse(page: string): Promise<string> {
  await throttleParse();

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
