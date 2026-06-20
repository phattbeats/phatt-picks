/**
 * HLTV RSS client (server-only) — automated wire source (PHA-859, PHA-863).
 *
 * Modeled on liquipedia.ts: a descriptive User-Agent naming the app + a contact,
 * gzip requested, and graceful degrade. HLTV has no official API and is
 * Cloudflare-gated for HTML scraping, but its own RSS endpoint returns
 * `application/rss+xml` 200 without challenge (confirmed on PHA-859 before
 * building), so we read the feed and never scrape.
 *
 * The refresh cadence is owned by the persisted floor in `claimRefreshSlot`
 * (PHA-863): a single atomic compare-and-set on SourceState (source = "hltv")
 * that the orchestration layer (lib/news) calls ONCE to gate the whole refresh —
 * seed upsert + network pull — under one stamp. This replaces the old
 * read-then-stamp pair (checkPersistedThrottle + stampPersistedThrottle), which
 * let concurrent first-requests both pass the floor (thundering herd) and
 * serialized nothing across processes. `fetchHltvWire` itself is now a plain
 * best-effort fetch+parse with no throttle of its own, so it can't double-claim
 * the slot.
 *
 * Importing this from a client component is a build error by design (it must
 * stay server-side; it carries the contact e-mail in the UA).
 */

import {
  claimRefreshSlot as claimSourceRefreshSlot,
  stampRefreshSlot as stampSourceRefreshSlot,
} from "./source-refresh";
import { parseHltvRss, HLTV_SOURCE } from "./hltv-core";
import type { WireItem } from "./news-core";

// HLTV's own news RSS. Returns application/rss+xml without a Cloudflare
// challenge; HTML scraping is what gets gated, so we deliberately read the feed.
const FEED_URL = "https://www.hltv.org/rss/news";

// Descriptive UA naming the app + a contact, same courtesy as the Liquipedia
// client. Generic UAs are exactly what gets challenged.
const USER_AGENT =
  "HOTLINE/1.0 (CS2 Major Pick'Em companion; contact: admin@phatt.vip)";

/**
 * Persisted refresh floor. The feed updates a few times an hour at most during
 * an event, so a 5-minute floor is plenty fresh while guaranteeing a
 * restart-loop or an over-eager render can never exceed ~12 pulls/hour.
 */
const REFRESH_MIN_INTERVAL_MS = 5 * 60_000;

const SOURCE = HLTV_SOURCE;

// Bound the network read so a hung connection can't wedge an ingest tick.
const FETCH_TIMEOUT_MS = 15_000;

export class HltvFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HltvFetchError";
  }
}

/**
 * Atomically claim the HLTV refresh slot against the 5-minute floor (PHA-863).
 * Replaces the old check-then-stamp pair, which let concurrent first-requests
 * both pass the floor (thundering herd) and serialized nothing across processes.
 * The shared primitive owns the compare-and-set; this binds it to the wire's
 * source + interval so `news.ts` can call it argument-free.
 */
export function claimRefreshSlot(): Promise<boolean> {
  return claimSourceRefreshSlot(SOURCE, REFRESH_MIN_INTERVAL_MS);
}

/**
 * Unconditionally stamp the refresh slot to now, ignoring the floor. Used by the
 * owner-forced ingest path (`/api/news/ingest`) so a manual refresh both runs
 * the pull AND makes the read path back off for the next interval. (PHA-863.)
 */
export function stampRefreshSlot(): Promise<void> {
  return stampSourceRefreshSlot(SOURCE);
}

/**
 * Pull the HLTV news feed and map it to WireItems. UA-stamped and best-effort:
 * throws HltvFetchError on a network / non-200 failure (callers degrade to the
 * seed). Mapping itself never throws — a malformed body parses to [].
 *
 * The refresh floor is NOT applied here — callers gate the whole refresh once
 * via `claimRefreshSlot` (PHA-863) so the slot is never double-claimed.
 */
export async function fetchHltvWire(): Promise<WireItem[]> {
  let res: Response;
  try {
    res = await fetch(FEED_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "gzip",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new HltvFetchError(
      `HLTV feed fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!res.ok) {
    // A 403/503 here is Cloudflare gating the feed — the documented fallback
    // case. Surface it as an error so ingestNews degrades to the seed.
    throw new HltvFetchError(`HLTV feed returned ${res.status}`, res.status);
  }

  return parseHltvRss(await res.text());
}
