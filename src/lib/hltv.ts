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
 * Atomically claim the HLTV refresh slot. Returns true iff the 5-minute floor
 * has elapsed (or no row exists yet) AND this caller won the race — under
 * concurrency exactly one caller wins, the rest get false. This replaces the
 * old check-then-stamp pair, which let concurrent first-requests both pass the
 * floor (thundering herd) and serialized nothing across processes. (PHA-863.)
 *
 * The win is decided by a single `updateMany` guarded by `lastCallAt < floor`:
 * SQLite serializes the write, so only one row update flips the stamp past the
 * floor. A `count` of 0 means either the row is within the floor OR it doesn't
 * exist yet — we disambiguate with a `create`, which succeeds only in the
 * first-ever case and trips the unique constraint (→ false) otherwise.
 *
 * Best-effort: any DB error resolves to "allowed" so a storage hiccup never
 * permanently blocks the wire.
 */
export async function claimRefreshSlot(): Promise<boolean> {
  const now = new Date();
  const floor = new Date(now.getTime() - REFRESH_MIN_INTERVAL_MS);
  try {
    const res = await prisma.sourceState.updateMany({
      where: { source: SOURCE, lastCallAt: { lt: floor } },
      data: { lastCallAt: now },
    });
    if (res.count > 0) return true; // won the slot: floor had elapsed
    // No matching row: first-ever call (no row) vs. within the floor.
    // INSERT OR IGNORE is atomic — succeeds only when no row exists, silently
    // skips otherwise. Avoids the P2002 that `create` throws (and Prisma logs)
    // when multiple workers race at startup before the row exists.
    const inserted = await prisma.$executeRaw`
      INSERT OR IGNORE INTO "SourceState" ("source", "lastCallAt")
      VALUES (${SOURCE}, ${now})
    `;
    return inserted > 0; // 1 = first-ever pull; 0 = within floor or lost the race
  } catch {
    return true; // DB hiccup — don't let storage block the wire
  }
}

/**
 * Unconditionally stamp the refresh slot to now, ignoring the floor. Used by the
 * owner-forced ingest path (`/api/news/ingest`) so a manual refresh both runs
 * the pull AND makes the read path back off for the next interval. Best-effort.
 * (PHA-863.)
 */
export async function stampRefreshSlot(): Promise<void> {
  const now = new Date();
  try {
    await prisma.sourceState.upsert({
      where: { source: SOURCE },
      update: { lastCallAt: now },
      create: { source: SOURCE, lastCallAt: now },
    });
  } catch {
    // best-effort — a failed stamp just means the next read may re-pull early
  }
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
