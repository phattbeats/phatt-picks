/**
 * Live Swiss W-L standings ingestion (server-only, PHA-902).
 *
 * The HLTV/BLAST-style standings table (every team's running win-loss record +
 * advance/eliminated status) is NOT in Valve's Pick'Em answer key — that only
 * carries the final clinch bucket as teams lock in. So we read it from the one
 * source that publishes a live Swiss table for this event: the HLTV event page.
 * HLTV gates HTML scraping behind Cloudflare (a direct server fetch 403s — the
 * RSS feed PHA-859 uses is the only un-gated endpoint), so we go through the
 * shared crawl4ai service, which renders the page and returns clean markdown.
 * crawl4ai sits on the same `phattvip` Docker network as this container, so
 * `http://crawl4ai:11235` is reachable in production exactly as in the workspace
 * (override with CRAWL4AI_URL).
 *
 * Cadence is owned by a persisted ~hourly floor (claimStandingsRefreshSlot),
 * the same atomic SourceState compare-and-set the wire (PHA-863) and outcomes
 * (PHA-866) drivers use. `getSwissStandings` is the read path: it fires a
 * best-effort, deferred self-refresh (off the render path) and returns the last
 * cached blob mapped to the current layout. Graceful by contract: a source
 * outage / parse miss degrades to the last cache (or empty) and NEVER throws
 * into the render — and never fabricates a record.
 */

import { after } from "next/server";
import { prisma } from "./db";
import {
  parseHltvSwissStandings,
  matchStandingsToLayout,
  type RawStandingRow,
  type StandingRow,
  type MatchableTeam,
} from "./swiss-results-core";
import {
  parseSwissBracket,
  matchBracketToLayout,
  type RawSwissRound,
  type SwissRound,
} from "./swiss-bracket-core";
import { isWithinRefreshWindow } from "./lock-schedule-core";
// Which HLTV event page carries the live Swiss table for each pick'em section
// is now per-event config in the registry (PHA-948). For the active event
// (Cologne) these are exactly the section ids/urls this module declared before.
import { SECTION_SOURCES } from "./events-core";

// crawl4ai on the phattvip network. Same hostname resolves in the workspace and
// in the deployed container; CRAWL4AI_URL overrides for other topologies.
const CRAWL4AI_URL = (process.env.CRAWL4AI_URL ?? "http://crawl4ai:11235").replace(/\/+$/, "");

// ~Hourly refresh floor (Brandon: "refreshing every hour"). The driver attempts
// at most one pull per hour across the whole cluster.
const REFRESH_MIN_INTERVAL_MS = 60 * 60_000;
const STANDINGS_REFRESH_SOURCE = "hltv-standings";

// Bound the crawl so a hung render service can't wedge a refresh tick. crawl4ai
// renders + bypasses Cloudflare, so it's slower than a bare fetch — give it room
// but cap it; this runs deferred (off the render path) anyway.
const CRAWL_TIMEOUT_MS = 45_000;

/** The persisted blob shape (data column of SwissStandingsCache). */
interface StandingsBlob {
  rows: RawStandingRow[];
  /** The full Swiss bracket (rounds of matches) parsed from the same crawl. */
  bracket?: RawSwissRound[];
  source: string;
  sourceUrl: string;
  fetchedAt: number;
}

/** The read-path result: rows matched to the current layout + provenance. */
export interface LiveStandings {
  rows: StandingRow[];
  source: string;
  sourceUrl: string;
  fetchedAtIso: string;
}

/** The read-path result for the bracket view. */
export interface LiveBracket {
  rounds: SwissRound[];
  source: string;
  sourceUrl: string;
  fetchedAtIso: string;
}

export function hasStandingsSource(sectionId: number): boolean {
  return sectionId in SECTION_SOURCES;
}

/**
 * Atomically claim the standings refresh slot against the ~1h floor — mirrors
 * hltv.claimRefreshSlot / claimOutcomesRefreshSlot. Returns true iff the floor
 * has elapsed (or no row exists yet) AND this caller won the race; under
 * concurrency exactly one wins. Best-effort: a DB hiccup resolves to "allowed"
 * so storage never permanently blocks the driver.
 */
async function claimStandingsRefreshSlot(): Promise<boolean> {
  const now = new Date();
  const floor = new Date(now.getTime() - REFRESH_MIN_INTERVAL_MS);
  try {
    const res = await prisma.sourceState.updateMany({
      where: { source: STANDINGS_REFRESH_SOURCE, lastCallAt: { lt: floor } },
      data: { lastCallAt: now },
    });
    if (res.count > 0) return true; // won the slot: floor had elapsed
    // id + updatedAt are NOT NULL with only client-side Prisma defaults, so a raw
    // insert MUST supply them or OR IGNORE silently swallows the NOT NULL violation
    // and the row never inserts (permanent wedge on a fresh DB). Generate the id in
    // SQL and stamp updatedAt = now.
    const inserted = await prisma.$executeRaw`
      INSERT OR IGNORE INTO "SourceState" ("id", "source", "lastCallAt", "updatedAt")
      VALUES (lower(hex(randomblob(16))), ${STANDINGS_REFRESH_SOURCE}, ${now}, ${now})
    `;
    return inserted > 0; // 1 = first-ever pull; 0 = within floor or lost the race
  } catch {
    return true; // DB hiccup — don't let storage block the driver
  }
}

/** Unconditionally stamp the refresh slot (owner-forced ingest backs the read path off). */
async function stampStandingsRefreshSlot(): Promise<void> {
  const now = new Date();
  try {
    await prisma.sourceState.upsert({
      where: { source: STANDINGS_REFRESH_SOURCE },
      update: { lastCallAt: now },
      create: { source: STANDINGS_REFRESH_SOURCE, lastCallAt: now },
    });
  } catch {
    // best-effort — a failed stamp just means the next read may re-pull early
  }
}

/**
 * Render a page through crawl4ai (bypasses the Cloudflare gate that 403s a direct
 * fetch), returning both its markdown (cleanest for the standings table) and its
 * HTML (the Swiss bracket embeds each match's data in a `data-...-popup-json`
 * attribute, which markdown flattens away). Best-effort: throws on a network /
 * non-2xx / empty-body failure so the caller degrades to the last cache. Never
 * used on the render path directly — the driver defers it.
 */
async function crawlPage(url: string): Promise<{ markdown: string; html: string }> {
  const res = await fetch(`${CRAWL4AI_URL}/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls: [url], crawler_config: { cache_mode: "BYPASS" } }),
    cache: "no-store",
    signal: AbortSignal.timeout(CRAWL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`crawl4ai returned ${res.status}`);
  const json = (await res.json()) as {
    success?: boolean;
    results?: Array<{ markdown?: string | { raw_markdown?: string }; html?: string }>;
  };
  const r = json.results?.[0];
  const md = r?.markdown;
  const markdown = typeof md === "string" ? md : (md?.raw_markdown ?? "");
  const html = r?.html ?? "";
  if (!markdown && !html) throw new Error("crawl4ai returned no content");
  return { markdown, html };
}

/**
 * Fetch + parse + persist the live standings for one section. Best-effort:
 * returns the count of parsed rows, or 0 on any failure (outage, parse miss,
 * unmapped section) — it NEVER throws and NEVER overwrites a good cache with an
 * empty parse (so a transient Cloudflare hiccup can't blank the table). Stamps
 * the floor so the read path backs off afterward.
 */
async function ingestStandings(eventId: number, sectionId: number): Promise<number> {
  const src = SECTION_SOURCES[sectionId];
  if (!src) return 0; // no known source for this section — nothing to do
  try {
    const { markdown, html } = await crawlPage(src.url);
    const rows = parseHltvSwissStandings(markdown);
    const bracket = parseSwissBracket(html);
    if (rows.length === 0 && bracket.length === 0) {
      // Parsed nothing from either view — keep whatever we have, don't blank it.
      console.warn(`[standings] parsed 0 rows + 0 bracket rounds for section ${sectionId} — keeping prior cache`);
      return 0;
    }
    const blob: StandingsBlob = {
      rows,
      bracket,
      source: src.label,
      sourceUrl: src.url,
      fetchedAt: Date.now(),
    };
    const data = JSON.stringify(blob);
    await prisma.swissStandingsCache.upsert({
      where: { eventId_sectionId: { eventId, sectionId } },
      update: { data, fetchedAt: new Date() },
      create: { eventId, sectionId, data, fetchedAt: new Date() },
    });
    return Math.max(rows.length, bracket.reduce((n, r) => n + r.matches.length, 0));
  } catch (e) {
    console.error(
      "[standings] ingest failed (non-fatal, keeping prior cache):",
      e instanceof Error ? e.message : e,
    );
    return 0;
  }
}

/**
 * On-read self-refresh (mirrors refreshWireOnRead / refreshOutcomesOnRead). One
 * atomic ~1h claim gates the whole refresh: lose it → no-op (warm window or a
 * concurrent render holds it); win it → DEFER the slow crawl past the response
 * so it never adds page latency. The <AutoRefresh> sibling re-renders the route,
 * so a cold first paint that shows nothing fills in within a minute. Never
 * throws. No cron needed — and the ingest route is owner-gated anyway.
 *
 * Gated to the stage's refresh window (PHA-902/PHA-943): the window OPENS 24h
 * before the stage's lock — so the opening matchups land before picks even close
 * (Brandon: "the bracket should go live 24 hours before the start of the stage,
 * or whenever the first round of matches are announced") — and CLOSES at the end
 * of its committed competition window; outside it (long before a stage, after it's
 * decided) we serve the last cache and never crawl. `nowMs` is injected from the
 * render so the gate shares the page's request clock.
 */
export async function refreshStandingsOnRead(
  eventId: number,
  sectionId: number,
  nowMs: number = Date.now(),
): Promise<void> {
  if (!hasStandingsSource(sectionId)) return; // nothing to refresh
  if (!isWithinRefreshWindow(sectionId, nowMs)) return; // outside the reveal→end window — serve cache
  if (!(await claimStandingsRefreshSlot())) return; // within floor or lost the race
  runDeferred(() => ingestStandings(eventId, sectionId));
}

/**
 * Force a synchronous refresh, bypassing the floor — the owner-triggered entry
 * point (an ingest route / deploy smoke). Stamps the floor so the read path
 * backs off afterward. Best-effort; returns rows written.
 */
export async function ingestStandingsNow(eventId: number, sectionId: number): Promise<number> {
  const n = await ingestStandings(eventId, sectionId);
  await stampStandingsRefreshSlot();
  return n;
}

/** Is there already a cached standings blob for this section? (cheap existence check) */
async function hasCachedSection(eventId: number, sectionId: number): Promise<boolean> {
  try {
    const row = await prisma.swissStandingsCache.findUnique({
      where: { eventId_sectionId: { eventId, sectionId } },
      select: { id: true },
    });
    return row != null;
  } catch {
    return false;
  }
}

export interface WarmResult {
  section: number;
  status: "no-source" | "off-window" | "fresh" | "ingested" | "kept-cache";
  rows: number;
}

/**
 * Synchronously warm a section's standings cache (PHA-902 deploy-reliability).
 *
 * The on-read driver (refreshStandingsOnRead) defers its crawl past the response
 * via `after()`, which means a freshly-deployed container with an empty cache
 * shows nothing until a crawl lands — and if `after()` ever doesn't fire, the
 * cache never fills at all. This is the synchronous, awaited path the ingest
 * route (and a deploy smoke) call so the cache is guaranteed populated without
 * depending on `after()` or a user happening to load the page.
 *
 * Safe to expose: only crawls the hard-coded HLTV event (no user input) and is
 * gated — off-window → no-op; if a cache already exists it's bounded by the same
 * ~1h SourceState claim so it can't be hammered; a COLD cache always crawls so a
 * stamped-but-empty state self-heals. Never throws.
 */
export async function warmStandings(
  eventId: number,
  sectionId: number,
  nowMs: number = Date.now(),
): Promise<WarmResult> {
  if (!hasStandingsSource(sectionId)) return { section: sectionId, status: "no-source", rows: 0 };
  if (!isWithinRefreshWindow(sectionId, nowMs)) return { section: sectionId, status: "off-window", rows: 0 };
  const cold = !(await hasCachedSection(eventId, sectionId));
  // Warm cache → respect the ~1h floor (don't re-crawl on every poke). Cold
  // cache → always crawl, so a stamped-but-empty slot can't wedge it shut.
  if (!cold && !(await claimStandingsRefreshSlot())) return { section: sectionId, status: "fresh", rows: 0 };
  const rows = await ingestStandings(eventId, sectionId);
  await stampStandingsRefreshSlot();
  return { section: sectionId, status: rows > 0 ? "ingested" : "kept-cache", rows };
}

/** The sections that have a live standings source (for the warm-all entry point). */
export function standingsSectionIds(): number[] {
  return Object.keys(SECTION_SOURCES).map(Number);
}

/**
 * Read the live standings for a section, mapped to the current layout teams (for
 * logos + the viewer-pick highlight). Returns null when nothing is cached yet
 * (cold start before the first refresh lands, or an unmapped section). Never
 * throws — a missing table / DB hiccup degrades to null and the UI hides the
 * panel.
 */
export async function getSwissStandings(
  eventId: number,
  sectionId: number,
  teams: readonly MatchableTeam[],
): Promise<LiveStandings | null> {
  if (!hasStandingsSource(sectionId)) return null;
  let row;
  try {
    row = await prisma.swissStandingsCache.findUnique({
      where: { eventId_sectionId: { eventId, sectionId } },
    });
  } catch {
    return null; // table absent (pre-migration) or DB hiccup — hide the panel
  }
  if (!row) return null;
  let blob: StandingsBlob;
  try {
    blob = JSON.parse(row.data) as StandingsBlob;
  } catch {
    return null; // corrupt blob — hide rather than crash
  }
  if (!Array.isArray(blob.rows) || blob.rows.length === 0) return null;
  return {
    rows: matchStandingsToLayout(blob.rows, teams),
    source: blob.source,
    sourceUrl: blob.sourceUrl,
    fetchedAtIso: new Date(blob.fetchedAt ?? row.fetchedAt.getTime()).toISOString(),
  };
}

/**
 * Read the live Swiss BRACKET for a section, mapped to the current layout teams.
 * Same cache row as the standings table (one crawl populates both); returns null
 * when no bracket is cached yet (cold start / unmapped section / a snapshot taken
 * before the bracket parser shipped). Never throws.
 */
export async function getSwissBracket(
  eventId: number,
  sectionId: number,
  teams: readonly MatchableTeam[],
): Promise<LiveBracket | null> {
  if (!hasStandingsSource(sectionId)) return null;
  let row;
  try {
    row = await prisma.swissStandingsCache.findUnique({
      where: { eventId_sectionId: { eventId, sectionId } },
    });
  } catch {
    return null;
  }
  if (!row) return null;
  let blob: StandingsBlob;
  try {
    blob = JSON.parse(row.data) as StandingsBlob;
  } catch {
    return null;
  }
  if (!Array.isArray(blob.bracket) || blob.bracket.length === 0) return null;
  return {
    rounds: matchBracketToLayout(blob.bracket, teams),
    source: blob.source,
    sourceUrl: blob.sourceUrl,
    fetchedAtIso: new Date(blob.fetchedAt ?? row.fetchedAt.getTime()).toISOString(),
  };
}

/**
 * Best-effort background task off the render path (Next `after`, falling back to
 * a floating promise outside a request scope). Errors swallowed — best-effort.
 */
function runDeferred(task: () => Promise<unknown>): void {
  const run = () => {
    void task().catch((e) => console.error("[standings] deferred refresh failed (non-fatal):", e));
  };
  try {
    after(run);
  } catch {
    run();
  }
}
