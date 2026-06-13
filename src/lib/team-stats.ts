/**
 * Live team-dossier recent-results refresh (server-only, PHA-921).
 *
 * The team dossier (roster / world rank / last-5 matches) ships as a frozen
 * snapshot in team-stats-core, refreshed by hand at each stage boundary via
 * scripts/gather-team-stats.ts (PHA-897). This module AUTOMATES the recent-match
 * half of that refresh, the same way PHA-902 auto-refreshes the live Swiss
 * standings: an on-read, atomic-claimed, deferred crawl that persists a cache and
 * is gated to the committed match windows so it only fires on days games are
 * played. Roster + world rank stay frozen (they move slowly — bump by hand); only
 * `recent[]` is pulled live, so "at the start of Stage 2 the Stage 1 teams show
 * their just-played results" happens on its own.
 *
 * Unlike the standings (one HLTV EVENT page per section), the dossier is keyed by
 * each team's HLTV PROFILE — global across stages — so the cache is a single blob
 * per event and the gate is `isWithinAnyMatchWindow` (any stage playing), not the
 * per-section window. One crawl4ai request batches all 32 profiles, retrying the
 * teams HLTV challenges and accumulating coverage across hourly cycles.
 *
 * Graceful by contract: a source outage / parse miss degrades to the last cache,
 * and the read path ALWAYS merges over the committed frozen snapshot, so the
 * drawer never renders empty and never shows a fabricated result.
 */

import { after } from "next/server";
import { prisma } from "./db";
import {
  TEAM_SOURCES,
  teamStatsCrawlTargets,
  parseRecentResults,
  mergeLiveStats,
  accumulateRecentAcrossPasses,
  CRAWL_PASS_TIMEOUT_MS,
  CRAWL_CHUNK_SIZE,
  CRAWL_CHUNK_TIMEOUT_MS,
  CRAWL_PAGE_TIMEOUT_MS,
  type ParsedMatch,
} from "./team-stats-sources";
import { statsForPickid, type TeamStats } from "./team-stats-core";
import { isWithinAnyMatchWindow } from "./lock-schedule-core";
import { isEventFrozenById } from "./event-freeze";

// crawl4ai on the phattvip network — same hostname in workspace + deployed
// container; CRAWL4AI_URL overrides for other topologies (mirrors swiss-results).
const CRAWL4AI_URL = (process.env.CRAWL4AI_URL ?? "http://crawl4ai:11235").replace(/\/+$/, "");
const CRAWL4AI_TOKEN = process.env.CRAWL4AI_API_TOKEN ?? "Phatt-tech-2026";

// ~Hourly refresh floor — the dossier's recent results only move when teams play,
// so one batch crawl per hour during a stage is plenty.
const REFRESH_MIN_INTERVAL_MS = 60 * 60_000;
const TEAM_STATS_REFRESH_SOURCE = "hltv-team-stats";

// The per-pass timeout + multi-pass retry/budget policy live in the pure
// team-stats-sources module (CRAWL_PASS_TIMEOUT_MS / MAX_TOTAL_CRAWL_MS /
// MAX_CRAWL_PASSES) so the verify harness can prove the retry + partial-discard
// behaviour offline. crawl4ai renders the 32 profiles in ONE request
// SEQUENTIALLY (a burst of parallel requests trips HLTV's Cloudflare challenge);
// measured ~120s for the full field. Runs deferred (off the render path) on the
// on-read path; the warm route awaits it (a one-shot ops/deploy poke).

/** The persisted blob shape (data column of TeamStatsCache). */
interface TeamStatsBlob {
  /** pickid → most-recent-first matches parsed live from HLTV. */
  recentByPickid: Record<number, ParsedMatch[]>;
  source: string;
  fetchedAt: number;
}

/** The read-path result: the merged dossier map + provenance. */
export interface LiveTeamStats {
  /** pickid → stats with `recent[]` overridden live, roster/rank kept frozen. */
  byPickid: Record<number, TeamStats>;
  source: string;
  /** YYYY-MM-DD (UTC) of the live crawl — the drawer's "snapshot" label. */
  asOf: string;
  fetchedAtIso: string;
}

/**
 * Atomically claim the refresh slot against the ~1h floor — identical pattern to
 * claimStandingsRefreshSlot / claimOutcomesRefreshSlot. Returns true iff the floor
 * has elapsed (or no row exists) AND this caller won the race. Best-effort: a DB
 * hiccup resolves to "allowed" so storage never permanently blocks the driver.
 */
async function claimRefreshSlot(): Promise<boolean> {
  const now = new Date();
  const floor = new Date(now.getTime() - REFRESH_MIN_INTERVAL_MS);
  try {
    const res = await prisma.sourceState.updateMany({
      where: { source: TEAM_STATS_REFRESH_SOURCE, lastCallAt: { lt: floor } },
      data: { lastCallAt: now },
    });
    if (res.count > 0) return true; // won the slot: floor had elapsed
    // id + updatedAt are NOT NULL with only client-side Prisma defaults, so a raw
    // insert MUST supply them or OR IGNORE silently swallows the NOT NULL violation
    // and the row never inserts (permanent wedge on a fresh DB). Generate the id in
    // SQL and stamp updatedAt = now.
    const inserted = await prisma.$executeRaw`
      INSERT OR IGNORE INTO "SourceState" ("id", "source", "lastCallAt", "updatedAt")
      VALUES (lower(hex(randomblob(16))), ${TEAM_STATS_REFRESH_SOURCE}, ${now}, ${now})
    `;
    return inserted > 0; // 1 = first-ever pull; 0 = within floor or lost the race
  } catch {
    return true; // DB hiccup — don't let storage block the driver
  }
}

/** Unconditionally stamp the refresh slot (a forced ingest backs the read path off). */
async function stampRefreshSlot(): Promise<void> {
  const now = new Date();
  try {
    await prisma.sourceState.upsert({
      where: { source: TEAM_STATS_REFRESH_SOURCE },
      update: { lastCallAt: now },
      create: { source: TEAM_STATS_REFRESH_SOURCE, lastCallAt: now },
    });
  } catch {
    // best-effort — a failed stamp just means the next read may re-pull early
  }
}

/** crawl4ai result shape we read (markdown can be a string or {raw_markdown}). */
interface Crawl4aiResult {
  url?: string;
  markdown?: string | { raw_markdown?: string };
}

function resultMarkdown(r: Crawl4aiResult | undefined): string {
  const md = r?.markdown;
  return typeof md === "string" ? md : (md?.raw_markdown ?? "");
}

/**
 * Crawl ONE sub-batch of profiles in a single crawl4ai request (renders + bypasses
 * the Cloudflare gate that 403s a direct fetch). Returns pickid → markdown, matched
 * back by result url (crawl4ai may not preserve input order). Lighter page settings
 * (domcontentloaded + a tight page_timeout) stop the ~50s/page networkidle hangs
 * that burned a core each; semaphore_count belt-and-suspenders the dispatcher.
 * Throws on a network / non-2xx / empty-body failure so the caller can fall back.
 */
async function crawlChunk(
  targets: ReadonlyArray<{ pickid: number; url: string }>,
  timeoutMs: number,
): Promise<Record<number, string>> {
  const urlToPickid = new Map(targets.map((t) => [t.url, t.pickid]));
  const res = await fetch(`${CRAWL4AI_URL}/crawl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CRAWL4AI_TOKEN}`,
    },
    body: JSON.stringify({
      urls: targets.map((t) => t.url),
      crawler_config: {
        cache_mode: "BYPASS",
        wait_until: "domcontentloaded",
        page_timeout: CRAWL_PAGE_TIMEOUT_MS,
        semaphore_count: targets.length,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`crawl4ai returned ${res.status}`);
  const json = (await res.json()) as { results?: Crawl4aiResult[] };
  const results = json.results ?? [];
  if (results.length === 0) throw new Error("crawl4ai returned no results");
  const out: Record<number, string> = {};
  results.forEach((r, i) => {
    // Prefer matching by the result's own url; fall back to input order.
    const matched = r.url ? urlToPickid.get(r.url) : undefined;
    const pickid = matched ?? targets[i]?.pickid;
    if (pickid == null) return;
    const md = resultMarkdown(r);
    if (md) out[pickid] = md;
  });
  return out;
}

/**
 * Crawl the whole set of team profiles in SMALL SEQUENTIAL sub-batches (PHA-1036).
 * Handing crawl4ai all 32 URLs at once let its memory-adaptive dispatcher render
 * every page concurrently — on the uncapped container that lit all 12 threads and
 * froze the box (~460% CPU). Chunking by CRAWL_CHUNK_SIZE and awaiting each chunk
 * means the renderer never holds more than that many Chromium contexts at a time,
 * and fewer simultaneous HLTV hits also trips Cloudflare less (the original reason
 * this was a single request). `timeoutMs` is the budget for the WHOLE pass, sliced
 * across chunks; a chunk that fails is logged and skipped (its teams get retried on
 * the next pass / hourly tick), so partial coverage still lands. Throws only when
 * EVERY chunk failed, preserving the caller's "total outage → keep prior cache"
 * fallback. Never used directly on the render path — the driver defers it.
 */
async function crawlProfiles(
  targets: ReadonlyArray<{ pickid: number; url: string }>,
  timeoutMs: number = CRAWL_PASS_TIMEOUT_MS,
): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  const start = Date.now();
  let lastErr: unknown = null;
  for (let i = 0; i < targets.length; i += CRAWL_CHUNK_SIZE) {
    const elapsed = Date.now() - start;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) break; // pass budget spent — missing teams retried next pass
    const chunk = targets.slice(i, i + CRAWL_CHUNK_SIZE);
    try {
      Object.assign(out, await crawlChunk(chunk, Math.min(CRAWL_CHUNK_TIMEOUT_MS, remaining)));
    } catch (e) {
      lastErr = e;
      console.warn(
        `[team-stats] chunk ${Math.floor(i / CRAWL_CHUNK_SIZE) + 1} crawl failed; skipping ${chunk.length} team(s):`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  if (Object.keys(out).length === 0) {
    throw lastErr instanceof Error ? lastErr : new Error("crawl4ai returned no content");
  }
  return out;
}

/** Read the prior cached live results (so a partial refresh accumulates, not regresses). */
async function readPriorRecent(eventId: number): Promise<Record<number, ParsedMatch[]>> {
  try {
    const row = await prisma.teamStatsCache.findUnique({ where: { eventId } });
    if (!row) return {};
    const blob = JSON.parse(row.data) as TeamStatsBlob;
    return blob.recentByPickid && typeof blob.recentByPickid === "object" ? blob.recentByPickid : {};
  } catch {
    return {};
  }
}

/**
 * Crawl + parse + persist the live recent results for the whole field. Best-
 * effort: returns the number of teams with live matches after this run, or 0 on a
 * total failure (outage, every parse blocked) — it NEVER throws and NEVER blanks a
 * good cache.
 *
 * Two robustness properties, both because HLTV intermittently challenges the crawl:
 *  1. RETRY — re-crawls only the teams still missing a results table, up to
 *     MAX_CRAWL_PASSES (bounded by a total wall-clock budget). A pass that throws
 *     keeps the teams earlier passes landed instead of discarding them, so a
 *     transient crawl4ai 5xx never blanks a good partial (see PHA-944 /
 *     accumulateRecentAcrossPasses).
 *  2. ACCUMULATE — overlays this run's fresh results on top of the PRIOR cached
 *     results, so a team that was fetched live earlier keeps its live data even if
 *     this particular crawl missed it (it only ever upgrades to newer live data,
 *     never regresses to the frozen snapshot). Over a few hourly cycles coverage
 *     climbs to the full field and stays there.
 */
async function ingestTeamStats(eventId: number): Promise<number> {
  try {
    const all = teamStatsCrawlTargets();
    // Multi-pass crawl with per-pass retry + total budget. A later pass throwing
    // (transient crawl4ai 5xx/timeout) keeps the fresh from earlier passes rather
    // than discarding it — the persist block below then saves partial coverage
    // and the next ~1h tick re-pulls the still-missing teams (PHA-944).
    const fresh = await accumulateRecentAcrossPasses(all, crawlProfiles, parseRecentResults);

    const freshCount = Object.keys(fresh).length;
    if (freshCount === 0) {
      console.warn("[team-stats] parsed 0 teams with matches — keeping prior cache");
      return 0;
    }

    // Accumulate: prior live results, then this run's fresh ones on top.
    const prior = await readPriorRecent(eventId);
    const recentByPickid: Record<number, ParsedMatch[]> = { ...prior, ...fresh };

    const blob: TeamStatsBlob = {
      recentByPickid,
      source: "HLTV",
      fetchedAt: Date.now(),
    };
    const data = JSON.stringify(blob);
    await prisma.teamStatsCache.upsert({
      where: { eventId },
      update: { data, fetchedAt: new Date() },
      create: { eventId, data, fetchedAt: new Date() },
    });
    console.warn(
      `[team-stats] ingested ${freshCount} fresh, ${Object.keys(recentByPickid).length}/${all.length} total live after merge`,
    );
    return Object.keys(recentByPickid).length;
  } catch (e) {
    console.error(
      "[team-stats] ingest failed (non-fatal, keeping prior cache):",
      e instanceof Error ? e.message : e,
    );
    return 0;
  }
}

/**
 * On-read self-refresh (mirrors refreshStandingsOnRead / refreshOutcomesOnRead).
 * One atomic ~1h claim gates the whole refresh: lose it → no-op; win it → DEFER
 * the slow batch crawl past the response so it never adds page latency. Gated to
 * the event's match windows — off-days (between stages, before/after the event)
 * serve the cache and never crawl. `nowMs` is injected from the render so the gate
 * shares the page's request clock. Never throws. No cron needed.
 */
export async function refreshTeamStatsOnRead(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<void> {
  if (await isEventFrozenById(eventId, nowMs)) return; // PHA-949/954: frozen (effectively archived) Majors never re-crawl
  if (!isWithinAnyMatchWindow(nowMs)) return; // off-day — serve cache, don't crawl
  if (!(await claimRefreshSlot())) return; // within floor or lost the race
  runDeferred(() => ingestTeamStats(eventId));
}

/** Is there already a cached blob for this event? (cheap existence check) */
async function hasCache(eventId: number): Promise<boolean> {
  try {
    const row = await prisma.teamStatsCache.findUnique({
      where: { eventId },
      select: { id: true },
    });
    return row != null;
  } catch {
    return false;
  }
}

export interface WarmTeamStatsResult {
  status: "off-window" | "fresh" | "ingested" | "kept-cache";
  teams: number;
}

/**
 * Synchronously warm the team-stats cache (deploy-reliability, mirrors
 * warmStandings). The on-read driver defers its crawl via `after()`, so a freshly
 * deployed (empty-cache) container shows the frozen snapshot until a crawl lands;
 * this is the awaited path the refresh route (and a deploy smoke) call so the
 * cache is guaranteed populated. Off-window → no-op; a warm cache is bounded by
 * the same ~1h claim; a COLD cache always crawls so a stamped-but-empty slot
 * self-heals. Never throws.
 */
export async function warmTeamStats(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<WarmTeamStatsResult> {
  if (!isWithinAnyMatchWindow(nowMs)) return { status: "off-window", teams: 0 };
  const cold = !(await hasCache(eventId));
  if (!cold && !(await claimRefreshSlot())) return { status: "fresh", teams: 0 };
  const teams = await ingestTeamStats(eventId);
  await stampRefreshSlot();
  return { status: teams > 0 ? "ingested" : "kept-cache", teams };
}

function todayUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Read the live dossier for the field, merged over the frozen snapshot: each
 * team's `recent[]` is overridden by the live crawl when present, while roster +
 * world rank + hltvUrl stay frozen (the live crawl doesn't refresh those). Teams
 * with no live matches keep their frozen recent[]. Returns null when nothing is
 * cached yet (cold start) — the drawer then uses the frozen snapshot directly.
 * Never throws — a missing table / DB hiccup / corrupt blob degrades to null.
 */
export async function getLiveTeamStats(eventId: number): Promise<LiveTeamStats | null> {
  let row;
  try {
    row = await prisma.teamStatsCache.findUnique({ where: { eventId } });
  } catch {
    return null; // table absent (pre-migration) or DB hiccup — use frozen
  }
  if (!row) return null;
  let blob: TeamStatsBlob;
  try {
    blob = JSON.parse(row.data) as TeamStatsBlob;
  } catch {
    return null; // corrupt blob — use frozen
  }
  const live = blob.recentByPickid;
  if (!live || typeof live !== "object") return null;

  const byPickid: Record<number, TeamStats> = {};
  for (const pid of Object.keys(TEAM_SOURCES).map(Number)) {
    const frozen = statsForPickid(pid);
    if (!frozen) continue; // no frozen base — leave to the drawer's null fallback
    byPickid[pid] = mergeLiveStats(frozen, live[pid], TEAM_SOURCES[pid]);
  }
  const fetchedAt = blob.fetchedAt ?? row.fetchedAt.getTime();
  return {
    byPickid,
    source: blob.source ?? "HLTV",
    asOf: todayUtc(fetchedAt),
    fetchedAtIso: new Date(fetchedAt).toISOString(),
  };
}

/**
 * Best-effort background task off the render path (Next `after`, falling back to
 * a floating promise outside a request scope). Errors swallowed — best-effort.
 */
function runDeferred(task: () => Promise<unknown>): void {
  const run = () => {
    void task().catch((e) => console.error("[team-stats] deferred refresh failed (non-fatal):", e));
  };
  try {
    after(run);
  } catch {
    run();
  }
}
