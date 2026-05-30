/**
 * HLTV RSS client (server-only) — automated wire source (PHA-859).
 *
 * Modeled on liquipedia.ts: a descriptive User-Agent naming the app + a contact,
 * a persisted + in-process rate-limit gate, gzip requested, and graceful
 * degrade. HLTV has no official API and is Cloudflare-gated for HTML scraping,
 * but its own RSS endpoint returns `application/rss+xml` 200 without challenge
 * (confirmed on PHA-859 before building), so we read the feed and never scrape.
 *
 * Two throttles, same as the Liquipedia source:
 *   - an in-process serializing gate (back-to-back calls in one container);
 *   - a persisted SourceState gate (source = "hltv") so a restart-loop or a
 *     multi-process deploy can't hammer the feed. The persisted floor is the
 *     safety net; the actual refresh cadence is owned by whatever cron/routine
 *     POSTs /api/news/ingest (see ingestNews).
 *
 * Importing this from a client component is a build error by design (it must
 * stay server-side; it carries the contact e-mail in the UA).
 */

import { prisma } from "./db";
import { parseHltvRss, HLTV_SOURCE } from "./hltv-core";
import type { WireItem } from "./news-core";

// HLTV's own news RSS. Returns application/rss+xml without a Cloudflare
// challenge; HTML scraping is what gets gated, so we deliberately read the feed.
const FEED_URL = "https://www.hltv.org/rss/news";

// Descriptive UA naming the app + a contact, same courtesy as the Liquipedia
// client. Generic UAs are exactly what gets challenged.
const USER_AGENT =
  "phaTT-Picks/1.0 (Cologne pickem companion; contact: brandon@phatt.tech)";

/**
 * Persisted refresh floor. The feed updates a few times an hour at most during
 * an event, so a 5-minute floor is plenty fresh while guaranteeing a
 * restart-loop or an over-eager cron can never exceed ~12 pulls/hour. The cron
 * cadence should sit ABOVE this (e.g. ~15 min) — this is the backstop.
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

/** Raised when the persisted refresh floor would be violated by an immediate call. */
export class HltvThrottledError extends Error {
  constructor(readonly waitMs: number) {
    super(`HLTV feed throttled — wait ${waitMs}ms`);
    this.name = "HltvThrottledError";
  }
}

// Process-wide serializing gate: each pull waits until the floor after the
// previous one in this container. The DB gate below catches restart-loops and
// multi-process deploys that this in-memory gate can't see.
let fetchGate: Promise<void> = Promise.resolve();
function throttleFetch(): Promise<void> {
  const wait = fetchGate;
  let release: () => void;
  fetchGate = new Promise<void>((r) => (release = r));
  return wait.then(() => {
    setTimeout(() => release(), REFRESH_MIN_INTERVAL_MS);
  });
}

/** Throw if the persisted floor hasn't elapsed since the last pull. */
async function checkPersistedThrottle(): Promise<void> {
  const row = await prisma.sourceState.findUnique({ where: { source: SOURCE } });
  if (!row) return;
  const elapsed = Date.now() - row.lastCallAt.getTime();
  if (elapsed < REFRESH_MIN_INTERVAL_MS) {
    throw new HltvThrottledError(REFRESH_MIN_INTERVAL_MS - elapsed);
  }
}

/** Stamp the persisted floor — called immediately before every network attempt. */
async function stampPersistedThrottle(): Promise<void> {
  const now = new Date();
  await prisma.sourceState.upsert({
    where: { source: SOURCE },
    update: { lastCallAt: now },
    create: { source: SOURCE, lastCallAt: now },
  });
}

/**
 * Pull the HLTV news feed and map it to WireItems. Rate-limited (persisted +
 * in-process) and UA-stamped. Throws HltvThrottledError when the persisted
 * floor blocks the call (callers treat this as "skip this tick"), or
 * HltvFetchError on a network / non-200 failure. Mapping itself never throws —
 * a malformed body parses to [].
 */
export async function fetchHltvWire(): Promise<WireItem[]> {
  await checkPersistedThrottle();
  await throttleFetch();
  await stampPersistedThrottle();

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
