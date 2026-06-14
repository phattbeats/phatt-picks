/**
 * Spotlight live market odds — cached fetch (server-only, PHA-1066).
 *
 * Mirrors the on-read, atomic-claimed, deferred-refresh pattern of
 * `team-stats.ts` / `swiss-results.ts`, but the source is Polymarket's public
 * gamma-api (no auth, one small JSON per matchup) so it's a direct `fetch`, not a
 * crawl. One JSON-blob row per event (SpotlightOddsCache): pickid →
 * {@link SpotlightMarketLine}. The pure parse/label logic lives in
 * `spotlight-odds-core.ts` (verifiable offline); this file is just the I/O +
 * throttle + persistence shell.
 *
 * GATED: {@link PLAYOFF_MARKET_SLUGS} is empty until Valve seeds the bracket
 * (~Jun 16 2026, PHA-993). Empty registry ⇒ every entry point no-ops, the cache
 * stays empty, and {@link getSpotlightMarket} returns {} so the modal keeps its
 * "coming soon" state. Zero live change until an editor fills a matchup.
 *
 * Graceful by contract: a source outage / parse miss degrades to the last cache
 * and NEVER blanks a good prior line — a team fetched live earlier keeps its line
 * even if this cycle missed it (accumulate, same as the dossier).
 */

import { after } from "next/server";
import { prisma } from "./db";
import {
  PLAYOFF_MARKET_SLUGS,
  gammaEventUrl,
  resolveMatchupOdds,
  buildMarketLine,
  formatUpdatedLabel,
  ODDS_FETCH_TIMEOUT_MS,
  ODDS_REFRESH_MIN_INTERVAL_MS,
  type GammaEvent,
  type SpotlightMarketLine,
} from "./spotlight-odds-core";
import { isWithinAnyMatchWindow } from "./lock-schedule-core";
import { isEventFrozenById } from "./event-freeze";

const ODDS_REFRESH_SOURCE = "polymarket-spotlight-odds";

/** The persisted blob shape (data column of SpotlightOddsCache). */
interface SpotlightOddsBlob {
  /** pickid → market line (with `updatedLabel` recomputed at read time). */
  byPickid: Record<number, SpotlightMarketLine>;
  /**
   * pickid → the timestamp THAT line was actually fetched. Per-line, NOT one
   * blob-wide stamp: a partial refresh keeps prior lines (accumulate), so a
   * kept-but-not-refreshed line must report its OWN age, not the latest cycle's
   * (else a day-old line would read "just now"). `fetchedAt` is a fallback for
   * blobs written before this field existed.
   */
  fetchedAtByPickid?: Record<number, number>;
  /** Wall-clock of the latest ingest cycle (fallback when per-line stamp absent). */
  fetchedAt: number;
}

/**
 * Atomically claim the refresh slot against the ~1h floor — identical pattern to
 * claimRefreshSlot in team-stats.ts. Returns true iff the floor has elapsed (or
 * no row exists) AND this caller won the race. Best-effort: a DB hiccup resolves
 * to "allowed" so storage never permanently blocks the driver.
 */
async function claimRefreshSlot(): Promise<boolean> {
  const now = new Date();
  const floor = new Date(now.getTime() - ODDS_REFRESH_MIN_INTERVAL_MS);
  try {
    const res = await prisma.sourceState.updateMany({
      where: { source: ODDS_REFRESH_SOURCE, lastCallAt: { lt: floor } },
      data: { lastCallAt: now },
    });
    if (res.count > 0) return true;
    // id + updatedAt are NOT NULL with only client-side Prisma defaults, so the
    // raw insert MUST supply them or OR IGNORE swallows the NOT NULL violation
    // (permanent wedge on a fresh DB). Generate the id in SQL, stamp updatedAt.
    const inserted = await prisma.$executeRaw`
      INSERT OR IGNORE INTO "SourceState" ("id", "source", "lastCallAt", "updatedAt")
      VALUES (lower(hex(randomblob(16))), ${ODDS_REFRESH_SOURCE}, ${now}, ${now})
    `;
    return inserted > 0;
  } catch {
    return true;
  }
}

/** Unconditionally stamp the refresh slot (a forced warm backs the read path off). */
async function stampRefreshSlot(): Promise<void> {
  const now = new Date();
  try {
    await prisma.sourceState.upsert({
      where: { source: ODDS_REFRESH_SOURCE },
      update: { lastCallAt: now },
      create: { source: ODDS_REFRESH_SOURCE, lastCallAt: now },
    });
  } catch {
    // best-effort
  }
}

/**
 * Fetch one matchup event from gamma-api. Returns the first event object (the
 * /events?slug= response is an array), or null on any network / non-2xx / shape
 * failure — the caller treats null as "keep this pickid's prior line".
 */
async function fetchGammaEvent(slug: string): Promise<GammaEvent | null> {
  try {
    const res = await fetch(gammaEventUrl(slug), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(ODDS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json) || json.length === 0) return null;
    return json[0] as GammaEvent;
  } catch {
    return null;
  }
}

/** Read the prior cached blob (so a partial refresh accumulates, not regresses). */
async function readPriorBlob(
  eventId: number,
): Promise<{ byPickid: Record<number, SpotlightMarketLine>; fetchedAtByPickid: Record<number, number> }> {
  const empty = { byPickid: {}, fetchedAtByPickid: {} };
  try {
    const row = await prisma.spotlightOddsCache.findUnique({ where: { eventId } });
    if (!row) return empty;
    const blob = JSON.parse(row.data) as SpotlightOddsBlob;
    const byPickid = blob.byPickid && typeof blob.byPickid === "object" ? blob.byPickid : {};
    // Older blobs lack per-line stamps: fall back to the blob-wide fetchedAt for
    // every kept line so their age is still bounded, never reset to "now".
    const fetchedAtByPickid =
      blob.fetchedAtByPickid && typeof blob.fetchedAtByPickid === "object"
        ? blob.fetchedAtByPickid
        : Object.fromEntries(Object.keys(byPickid).map((pid) => [pid, blob.fetchedAt]));
    return { byPickid, fetchedAtByPickid };
  } catch {
    return empty;
  }
}

/**
 * Fetch + parse + persist live odds for every authored matchup. Best-effort:
 * returns the number of pickids with a live line after this run, or 0 on a total
 * miss — NEVER throws and NEVER blanks a good cache. A pickid that fails to fetch
 * or resolve keeps its PRIOR line (accumulate). Empty registry ⇒ 0 (no-op).
 */
async function ingestSpotlightOdds(eventId: number, nowMs: number): Promise<number> {
  try {
    const entries = Object.entries(PLAYOFF_MARKET_SLUGS);
    if (entries.length === 0) return 0; // gated — nothing authored yet

    const fresh: Record<number, SpotlightMarketLine> = {};
    // Distinct slugs only fetched once even when both sides reference it.
    const eventBySlug = new Map<string, GammaEvent | null>();
    for (const [pickidStr, target] of entries) {
      const pickid = Number(pickidStr);
      if (!eventBySlug.has(target.slug)) {
        eventBySlug.set(target.slug, await fetchGammaEvent(target.slug));
      }
      const event = eventBySlug.get(target.slug) ?? null;
      const parsed = resolveMatchupOdds(event, target.teamName);
      if (!parsed) continue; // outage / unmatched — keep prior on merge below
      fresh[pickid] = buildMarketLine({
        teamName: target.teamName,
        parsed,
        fetchedAtMs: nowMs,
        nowMs,
        hltvMatchUrl: target.hltvMatchUrl,
      });
    }

    const freshCount = Object.keys(fresh).length;
    if (freshCount === 0) {
      console.warn("[spotlight-odds] resolved 0 live lines — keeping prior cache");
      return 0;
    }

    const prior = await readPriorBlob(eventId);
    const byPickid: Record<number, SpotlightMarketLine> = { ...prior.byPickid, ...fresh };
    // Stamp each FRESH line with this cycle's time; kept-prior lines retain their
    // own earlier stamp so their "updated N ago" stays honest after a partial run.
    const freshStamps = Object.fromEntries(Object.keys(fresh).map((pid) => [pid, nowMs]));
    const fetchedAtByPickid: Record<number, number> = { ...prior.fetchedAtByPickid, ...freshStamps };
    const blob: SpotlightOddsBlob = { byPickid, fetchedAtByPickid, fetchedAt: nowMs };
    const data = JSON.stringify(blob);
    await prisma.spotlightOddsCache.upsert({
      where: { eventId },
      update: { data, fetchedAt: new Date(nowMs) },
      create: { eventId, data, fetchedAt: new Date(nowMs) },
    });
    console.warn(
      `[spotlight-odds] ingested ${freshCount} fresh, ${Object.keys(byPickid).length} total live after merge`,
    );
    return Object.keys(byPickid).length;
  } catch (e) {
    console.error(
      "[spotlight-odds] ingest failed (non-fatal, keeping prior cache):",
      e instanceof Error ? e.message : e,
    );
    return 0;
  }
}

function runDeferred(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * On-read self-refresh (mirrors refreshTeamStatsOnRead). One atomic ~1h claim
 * gates the whole refresh; the fetch is DEFERRED past the response. Off-window /
 * frozen / empty-registry → no-op. Never throws. No cron needed.
 */
export async function refreshSpotlightOddsOnRead(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<void> {
  if (Object.keys(PLAYOFF_MARKET_SLUGS).length === 0) return; // gated — no matchups authored
  if (await isEventFrozenById(eventId, nowMs)) return; // archived Majors never re-fetch
  if (!isWithinAnyMatchWindow(nowMs)) return; // off-day — serve cache
  if (!(await claimRefreshSlot())) return; // within floor or lost the race
  runDeferred(() => ingestSpotlightOdds(eventId, nowMs));
}

/** Is there already a cached blob for this event? (cheap existence check) */
async function hasCache(eventId: number): Promise<boolean> {
  try {
    const row = await prisma.spotlightOddsCache.findUnique({
      where: { eventId },
      select: { id: true },
    });
    return row != null;
  } catch {
    return false;
  }
}

export interface WarmSpotlightOddsResult {
  status: "gated" | "off-window" | "fresh" | "ingested" | "kept-cache";
  lines: number;
}

/**
 * Synchronously warm the odds cache (deploy-reliability, mirrors warmTeamStats).
 * The on-read driver defers its fetch, so a freshly deployed (empty-cache)
 * container has no odds until one lands; this is the awaited path the refresh
 * route calls. Gated/off-window → no-op; a warm cache is bounded by the same ~1h
 * claim; a COLD cache always fetches so a stamped-but-empty slot self-heals.
 */
export async function warmSpotlightOdds(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<WarmSpotlightOddsResult> {
  if (Object.keys(PLAYOFF_MARKET_SLUGS).length === 0) return { status: "gated", lines: 0 };
  if (!isWithinAnyMatchWindow(nowMs)) return { status: "off-window", lines: 0 };
  const cold = !(await hasCache(eventId));
  if (!cold && !(await claimRefreshSlot())) return { status: "fresh", lines: 0 };
  const lines = await ingestSpotlightOdds(eventId, nowMs);
  await stampRefreshSlot();
  return { status: lines > 0 ? "ingested" : "kept-cache", lines };
}

/**
 * Read the cached market lines keyed by pickid, with each line's `updatedLabel`
 * recomputed against `nowMs` (the blob stores a fetch timestamp, not a frozen
 * label, so "updated 1h ago" stays honest as the page is re-served). Returns {}
 * when nothing is cached (cold / gated) — the modal then shows "coming soon".
 * Never throws — a missing table / DB hiccup / corrupt blob degrades to {}.
 */
export async function getSpotlightMarket(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<Record<number, SpotlightMarketLine>> {
  let row;
  try {
    row = await prisma.spotlightOddsCache.findUnique({ where: { eventId } });
  } catch {
    return {}; // table absent (pre-migration) or DB hiccup
  }
  if (!row) return {};
  let blob: SpotlightOddsBlob;
  try {
    blob = JSON.parse(row.data) as SpotlightOddsBlob;
  } catch {
    return {}; // corrupt blob
  }
  const lines = blob.byPickid;
  if (!lines || typeof lines !== "object") return {};
  const blobFetchedAt = blob.fetchedAt ?? row.fetchedAt.getTime();
  const stamps = blob.fetchedAtByPickid ?? {};
  const out: Record<number, SpotlightMarketLine> = {};
  for (const [pid, line] of Object.entries(lines)) {
    // Each line's age comes from ITS OWN fetch time (per-line stamp), so a kept
    // line from a partial earlier cycle reads honestly, not as fresh as the rest.
    const fetchedAt = stamps[Number(pid)] ?? blobFetchedAt;
    out[Number(pid)] = { ...line, updatedLabel: formatUpdatedLabel(fetchedAt, nowMs) };
  }
  return out;
}
