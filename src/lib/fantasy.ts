/**
 * HOTLINE Fantasy (server-only, PHA-5454) — the crawl, the DB and the read
 * models behind /fantasy. The rules live in fantasy-core.ts.
 *
 * INGESTION. Per-match player stats exist only on HLTV match pages, which sit
 * behind Cloudflare, so they come through crawl4ai like the Swiss standings.
 * Each tick, for every stage being played: read the stage's HLTV results page
 * (`/results?event=<id>`), and for each finished match not stored yet, read
 * its match page and store the parsed stat lines as a FantasyMatch row. A page
 * whose stats table is not complete yet parses to nothing and is retried on
 * the next tick. Each stored match is re-read once, a few hours later, to pick
 * up HLTV's post-match corrections.
 *
 * Driven by the in-process timer in instrumentation.ts (and, as a fallback, by
 * a page read). Bounded: a handful of crawls per tick, one at a time, because
 * the live box has a third of a CPU and crawl4ai is shared.
 *
 * Never throws into a render and never invents a number: a source outage means
 * the board waits.
 */

import { prisma } from "./db";
import { claimRefreshSlot, runDeferred } from "./source-refresh";
import { getEffectiveLayout } from "./layout-state";
import { currentEventId, getEventConfig, sectionsInPlayOrder, type EventConfig } from "./events-core";
import { isEventFrozenById } from "./event-freeze";
import { TEAM_SOURCES } from "./team-stats-sources";
import { statsForPickid } from "./team-stats-core";
import type { Layout } from "./layout";
import {
  FANTASY_EVENTS,
  buildPool,
  cleanTeamName,
  deriveStageField,
  fantasyStagesFor,
  hltvEventIdFromUrl,
  isStageComplete,
  lineupAction,
  parseHltvMatchPage,
  parseHltvResultsPage,
  parseLineup,
  playerStageTable,
  rankManagers,
  scoreLineup,
  stageForMatch,
  stagePhase,
  stageScoringStartMs,
  swissStatus,
  teamRecords,
  validateLineup,
  type FantasyMatchData,
  type FantasyPlayer,
  type FantasyStage,
  type Lineup,
  type LineupAction,
  type PlayerStageLine,
  type PoolTeamInput,
  type ScoredLineup,
  type StagePhase,
  type StandingRow,
  type TeamRecord,
} from "./fantasy-core";

const CRAWL4AI_URL = (process.env.CRAWL4AI_URL ?? "http://crawl4ai:11235").replace(/\/+$/, "");
const CRAWL4AI_TOKEN = process.env.CRAWL4AI_API_TOKEN ?? "";

/** Floor between ingest ticks for one event. */
const TICK_MIN_INTERVAL_MS = 8 * 60_000;
/** New match pages read per tick. A Swiss round finishes at most eight at once. */
const MAX_NEW_MATCHES_PER_TICK = 4;
/** Stored matches re-read per tick for HLTV's corrections. */
const MAX_REREADS_PER_TICK = 2;
/** A stored match is re-read once it is this old. */
const REREAD_AFTER_MS = 3 * 60 * 60_000;
/** Stop polling a stage this long after the next stage started. */
const NEXT_STAGE_GRACE_MS = 24 * 60 * 60_000;
// A match page is ~1 MB and crawl4ai is shared with the standings and team
// crawls: under load one page takes over a minute (measured 65 s).
const CRAWL_TIMEOUT_MS = 150_000;

/** Does this event have a fantasy game at all? */
export function hasFantasy(eventId: number): boolean {
  return eventId in FANTASY_EVENTS && getEventConfig(eventId) != null;
}

/**
 * Past Majors with a fantasy board worth opening: not the current event, and
 * at least one stored match. Newest first.
 */
export async function fantasyArchiveEvents(nowMs: number = Date.now()): Promise<EventConfig[]> {
  const current = currentEventId(nowMs);
  const ids = Object.keys(FANTASY_EVENTS).map(Number).filter((id) => id !== current && getEventConfig(id) != null);
  if (ids.length === 0) return [];
  const have = await prisma.fantasyMatch
    .findMany({ where: { eventId: { in: ids } }, select: { eventId: true }, distinct: ["eventId"] })
    .catch(() => [] as { eventId: number }[]);
  return have
    .map((r) => getEventConfig(r.eventId))
    .filter((e): e is EventConfig => e != null && Date.parse(e.dates.end) < nowMs)
    .sort((a, b) => Date.parse(b.dates.end) - Date.parse(a.dates.end));
}

/* ── crawl ────────────────────────────────────────────────────────────── */

async function crawlHtml(url: string): Promise<string> {
  const res = await fetch(`${CRAWL4AI_URL}/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CRAWL4AI_TOKEN}` },
    body: JSON.stringify({
      urls: [url],
      // Same settings as the standings crawl: the data is server-rendered, so
      // DOM-ready is enough and networkidle only hangs behind Cloudflare.
      crawler_config: { cache_mode: "BYPASS", wait_until: "domcontentloaded", page_timeout: 25_000 },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(CRAWL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`crawl4ai returned ${res.status}`);
  const json = (await res.json()) as { results?: Array<{ html?: string }> };
  const html = json.results?.[0]?.html ?? "";
  if (!html) throw new Error("crawl4ai returned no html");
  return html;
}

/* ── stage facts ──────────────────────────────────────────────────────── */

const PICKID_BY_HLTV_TEAM: ReadonlyMap<number, number[]> = (() => {
  const m = new Map<number, number[]>();
  for (const [pickid, src] of Object.entries(TEAM_SOURCES)) {
    m.set(src.hltvId, [...(m.get(src.hltvId) ?? []), Number(pickid)]);
  }
  return m;
})();

function sectionPickids(layout: Layout | null, sectionIds: readonly number[]): number[] {
  if (!layout) return [];
  const ids = new Set<number>();
  for (const s of layout.sections) {
    if (!sectionIds.includes(s.sectionid)) continue;
    for (const g of s.groups) for (const t of g.teams) if (t.pickid !== 0) ids.add(t.pickid);
  }
  return [...ids];
}

/** stage id -> the HLTV event id whose results page lists its matches. */
function stageHltvEvents(event: EventConfig, stages: readonly FantasyStage[]): Record<number, number> {
  const hub = FANTASY_EVENTS[event.eventId]?.hltvHubEventId;
  const out: Record<number, number> = {};
  for (const s of stages) {
    const own = s.kind === "swiss" ? hltvEventIdFromUrl(event.sectionSources[s.id]?.url) : null;
    const id = own ?? hub;
    if (id != null) out[s.id] = id;
  }
  return out;
}

export interface StageView {
  stage: FantasyStage;
  phase: StagePhase;
  /** The stage's first match (ms), or null while unpublished. */
  firstMatchMs: number | null;
  /** When the stage starts scoring (ms); later than firstMatchMs only by config. */
  startMs: number | null;
  pool: FantasyPlayer[];
  matches: FantasyMatchData[];
  /** HLTV team id -> record over the stage's stored matches. */
  records: Map<number, TeamRecord>;
  /** When the newest stored match was read, ms; null with none stored. */
  lastFetchedMs: number | null;
}

export interface FantasyContext {
  event: EventConfig;
  nowMs: number;
  frozen: boolean;
  stages: StageView[];
  /** The stage a manager should land on: open first, else the latest live/final, else the first. */
  currentStageId: number;
}

/**
 * Everything the fantasy game knows about an event right now: its stages, each
 * stage's pool, start, phase and stored matches. Returns null for an event
 * with no fantasy game.
 */
export async function loadFantasyContext(eventId: number, nowMs: number = Date.now()): Promise<FantasyContext | null> {
  const event = getEventConfig(eventId);
  if (!event || !(eventId in FANTASY_EVENTS)) return null;
  const stages = fantasyStagesFor(sectionsInPlayOrder(event));
  const [layout, frozen, rows] = await Promise.all([
    getEffectiveLayout(eventId).catch(() => null),
    isEventFrozenById(eventId, nowMs).catch(() => false),
    prisma.fantasyMatch
      .findMany({ where: { eventId }, select: { stageId: true, data: true, fetchedAt: true } })
      .catch(() => [] as { stageId: number; data: string; fetchedAt: Date }[]),
  ]);

  const matchesByStage = new Map<number, FantasyMatchData[]>();
  const fetchedByStage = new Map<number, number>();
  for (const r of rows) {
    try {
      const m = JSON.parse(r.data) as FantasyMatchData;
      matchesByStage.set(r.stageId, [...(matchesByStage.get(r.stageId) ?? []), m]);
      fetchedByStage.set(r.stageId, Math.max(fetchedByStage.get(r.stageId) ?? 0, r.fetchedAt.getTime()));
    } catch {
      // a corrupt row scores nothing rather than crashing the page
    }
  }

  const nameOf = new Map((layout?.teams ?? []).map((t) => [t.pickid, t.name]));
  const teamInput = (pickid: number): PoolTeamInput => {
    const stats = statsForPickid(pickid);
    return {
      pickid,
      name: nameOf.get(pickid) ?? TEAM_SOURCES[pickid]?.name ?? `Team ${pickid}`,
      hltvTeamId: TEAM_SOURCES[pickid]?.hltvId ?? null,
      worldRank: stats?.worldRank ?? null,
      roster: stats?.roster ?? [],
    };
  };

  const views: StageView[] = [];
  let prevSectionTeams: number[] = [];
  let prevField: number[] = [];
  let prevRecords = new Map<number, TeamRecord>();
  for (const stage of stages) {
    const matches = (matchesByStage.get(stage.id) ?? []).sort((a, b) => a.startMs - b.startMs);
    const records = teamRecords(matches);
    const inLayout = sectionPickids(layout, stage.kind === "swiss" ? stage.sectionIds : [stage.id]);
    let field: number[] | null = inLayout.length === stage.fieldSize ? inLayout : null;
    if (!field && views.length > 0) {
      // Valve has not trimmed the section yet: seeds + the previous stage's 3-win teams.
      const prevSet = new Set(prevField);
      const advanced: number[] = [];
      for (const [hltvId, rec] of prevRecords) {
        if (rec.wins < 3) continue;
        const pickid = (PICKID_BY_HLTV_TEAM.get(hltvId) ?? []).find((p) => prevSet.has(p));
        if (pickid != null) advanced.push(pickid);
      }
      field = deriveStageField({
        fieldSize: stage.fieldSize,
        sectionPickids: inLayout,
        previousSectionPickids: prevSectionTeams,
        previousAdvancedPickids: advanced,
      });
    }
    const pool = field ? buildPool(field.map(teamInput)) : [];
    const lockIso = event.lockSchedule[stage.id] ?? null;
    const lockMs = lockIso && Number.isFinite(Date.parse(lockIso)) ? Date.parse(lockIso) : null;
    // With no published first match, the earliest stored match is the start.
    const firstMatchMs = lockMs ?? (matches.length > 0 ? matches[0].startMs : null);
    const startMs =
      stageScoringStartMs(eventId, stage.id, lockIso) ?? (matches.length > 0 ? matches[0].startMs : null);
    const complete = isStageComplete(stage, matches);
    views.push({
      stage,
      phase: stagePhase({ poolReady: pool.length > 0, stageStartMs: startMs, nowMs, complete, frozen }),
      firstMatchMs,
      startMs,
      pool,
      matches,
      records,
      lastFetchedMs: fetchedByStage.get(stage.id) ?? null,
    });
    prevSectionTeams = inLayout;
    prevField = field ?? inLayout;
    prevRecords = records;
  }

  const open = views.find((v) => v.phase === "open");
  const started = [...views].reverse().find((v) => v.phase === "live" || v.phase === "final");
  const live = views.find((v) => v.phase === "live");
  const currentStageId = (live ?? open ?? started ?? views[0]).stage.id;
  return { event, nowMs, frozen, stages: views, currentStageId };
}

/* ── ingestion ────────────────────────────────────────────────────────── */

export interface FantasyTickResult {
  eventId: number;
  /** Results pages read. */
  listed: number;
  /** New matches stored. */
  ingested: number;
  /** Stored matches re-read for corrections. */
  reread: number;
  /** Finished matches seen whose stats were not ready (retried next tick). */
  pending: number;
  skipped?: string;
}

/**
 * The stages whose matches should be polled now: the first match has started,
 * the stage is not played out, and the following stage did not start more than
 * a day ago (a safety stop if "played out" is never detected, e.g. a forfeit).
 */
function stagesToPoll(ctx: FantasyContext): StageView[] {
  return ctx.stages.filter((v, i) => {
    if (v.firstMatchMs == null || ctx.nowMs < v.firstMatchMs) return false;
    if (isStageComplete(v.stage, v.matches)) return false;
    const next = ctx.stages[i + 1];
    if (next?.firstMatchMs != null && ctx.nowMs > next.firstMatchMs + NEXT_STAGE_GRACE_MS) return false;
    return true;
  });
}

async function storeMatch(eventId: number, stageId: number, m: FantasyMatchData, refreshed: boolean): Promise<void> {
  const data = JSON.stringify(m);
  await prisma.fantasyMatch.upsert({
    where: { hltvMatchId: m.hltvMatchId },
    update: { data, stageId, startAt: new Date(m.startMs), refreshed, fetchedAt: new Date() },
    create: { eventId, stageId, hltvMatchId: m.hltvMatchId, startAt: new Date(m.startMs), data, refreshed },
  });
}

/**
 * Read every finished match of one HLTV event into a stage, ignoring the tick
 * limits unless `maxNew` is given. Also used to replay a finished stage (the
 * day-one test) and for an owner backfill.
 */
export async function ingestHltvEvent(opts: {
  eventId: number;
  hltvEventId: number;
  maxNew?: number;
  onProgress?: (line: string) => void;
}): Promise<{ listed: number; ingested: number; pending: number; unplaced: number; stored: number[] }> {
  const event = getEventConfig(opts.eventId);
  if (!event) return { listed: 0, ingested: 0, pending: 0, unplaced: 0, stored: [] };
  const stages = fantasyStagesFor(sectionsInPlayOrder(event));
  const stageHltvEvent = stageHltvEvents(event, stages);
  const html = await crawlHtml(`https://www.hltv.org/results?event=${opts.hltvEventId}`);
  const links = parseHltvResultsPage(html);
  const known = new Set(
    (
      await prisma.fantasyMatch.findMany({
        where: { hltvMatchId: { in: links.map((l) => l.hltvMatchId) } },
        select: { hltvMatchId: true },
      })
    ).map((r) => r.hltvMatchId),
  );
  // Oldest first, so a partial tick fills the stage in play order.
  const fresh = links
    .filter((l) => !known.has(l.hltvMatchId))
    .sort((a, b) => (a.endedMs ?? 0) - (b.endedMs ?? 0))
    .slice(0, opts.maxNew ?? Infinity);
  let ingested = 0;
  let pending = 0;
  let unplaced = 0;
  const stored: number[] = [];
  for (const link of fresh) {
    try {
      const page = await crawlHtml(`https://www.hltv.org${link.path}`);
      const m = parseHltvMatchPage(page, link.hltvMatchId);
      if (!m) {
        pending++;
        opts.onProgress?.(`pending ${link.path}`);
        continue;
      }
      const stage = stageForMatch({ stages, stageHltvEvent, listedUnderHltvEvent: opts.hltvEventId, info: m.info });
      if (!stage) {
        unplaced++;
        opts.onProgress?.(`unplaced ${link.path}`);
        continue;
      }
      await storeMatch(opts.eventId, stage.id, { ...m, path: link.path }, false);
      ingested++;
      stored.push(m.hltvMatchId);
      opts.onProgress?.(`stored ${stage.short} ${m.team1.name} ${m.team1.score}-${m.team2.score} ${m.team2.name}`);
    } catch (e) {
      pending++;
      opts.onProgress?.(`failed ${link.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { listed: links.length, ingested, pending, unplaced, stored };
}

/** Re-read up to `limit` stored matches once, to pick up HLTV's corrections. */
async function rereadSettled(eventId: number, nowMs: number, limit: number): Promise<number> {
  const due = await prisma.fantasyMatch.findMany({
    where: { eventId, refreshed: false, fetchedAt: { lt: new Date(nowMs - REREAD_AFTER_MS) } },
    orderBy: { fetchedAt: "asc" },
    take: limit,
    select: { hltvMatchId: true, stageId: true, data: true },
  });
  let n = 0;
  for (const row of due) {
    try {
      const path = (JSON.parse(row.data) as FantasyMatchData).path;
      if (!path) {
        await prisma.fantasyMatch.update({ where: { hltvMatchId: row.hltvMatchId }, data: { refreshed: true } });
        continue;
      }
      const page = await crawlHtml(`https://www.hltv.org${path}`);
      const m = parseHltvMatchPage(page, row.hltvMatchId);
      if (m) {
        await storeMatch(eventId, row.stageId, { ...m, path }, true);
        n++;
      }
    } catch (e) {
      console.warn(`[fantasy] re-read of match ${row.hltvMatchId} failed (kept):`, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

/**
 * One ingest tick. Self-gating: no fantasy game, a frozen Major, or no stage
 * being played means no crawl. `force` skips the floor (the owner route).
 * Never throws.
 */
export async function ingestFantasyTick(
  eventId: number,
  nowMs: number = Date.now(),
  opts: { force?: boolean } = {},
): Promise<FantasyTickResult> {
  const result: FantasyTickResult = { eventId, listed: 0, ingested: 0, reread: 0, pending: 0 };
  try {
    const ctx = await loadFantasyContext(eventId, nowMs);
    if (!ctx) return { ...result, skipped: "no-fantasy" };
    if (ctx.frozen) return { ...result, skipped: "frozen" };
    const poll = stagesToPoll(ctx);
    const pendingRereads = await prisma.fantasyMatch.count({ where: { eventId, refreshed: false } });
    if (poll.length === 0 && pendingRereads === 0) return { ...result, skipped: "idle" };
    if (!opts.force && !(await claimRefreshSlot(`fantasy:${eventId}`, TICK_MIN_INTERVAL_MS))) {
      return { ...result, skipped: "floor" };
    }
    const stageHltvEvent = stageHltvEvents(ctx.event, ctx.stages.map((v) => v.stage));
    const hltvEvents = [...new Set(poll.map((v) => stageHltvEvent[v.stage.id]).filter((id): id is number => id != null))];
    let budget = MAX_NEW_MATCHES_PER_TICK;
    const newMatchIds: number[] = [];
    for (const hltvEventId of hltvEvents) {
      if (budget <= 0) break;
      try {
        const r = await ingestHltvEvent({ eventId, hltvEventId, maxNew: budget });
        result.listed++;
        result.ingested += r.ingested;
        result.pending += r.pending;
        newMatchIds.push(...r.stored);
        budget -= r.ingested + r.pending;
      } catch (e) {
        console.warn(`[fantasy] results page for HLTV event ${hltvEventId} failed:`, e instanceof Error ? e.message : e);
      }
    }
    if (newMatchIds.length > 0) {
      // Tell each manager what the new results did to his five. Imported
      // lazily: fantasy-pushes reads the board from this module.
      try {
        const { runFantasyPointsPushes } = await import("./fantasy-pushes");
        await runFantasyPointsPushes(eventId, newMatchIds);
      } catch (e) {
        console.warn("[fantasy-push] points push failed (non-fatal):", e instanceof Error ? e.message : e);
      }
    }
    result.reread = await rereadSettled(eventId, nowMs, MAX_REREADS_PER_TICK);
  } catch (e) {
    console.error("[fantasy] tick failed (non-fatal):", e instanceof Error ? e.message : e);
  }
  return result;
}

/** Page-read fallback for the timer: same tick, deferred past the response. */
export function refreshFantasyOnRead(eventId: number): void {
  runDeferred(() => ingestFantasyTick(eventId), "fantasy");
}

/* ── lineups ──────────────────────────────────────────────────────────── */

export interface StoredLineup {
  managerId: string;
  stageId: number;
  lineup: Lineup;
  lockedAtMs: number;
}

async function loadLineups(eventId: number): Promise<StoredLineup[]> {
  const rows = await prisma.fantasyLineup.findMany({ where: { eventId } });
  const out: StoredLineup[] = [];
  for (const r of rows) {
    let slots: unknown;
    try {
      slots = JSON.parse(r.slots);
    } catch {
      continue;
    }
    const lineup = parseLineup({ slots, captainId: r.captainId });
    if (lineup) out.push({ managerId: r.playerId, stageId: r.stageId, lineup, lockedAtMs: r.lockedAt.getTime() });
  }
  return out;
}

export type SaveLineupResult =
  | { ok: true; lockedAtMs: number; late: boolean }
  | { ok: false; status: number; error: string; problems?: string[] };

/**
 * Save a manager's lineup for a stage. While the stage is open it can be saved
 * any number of times; once the stage is live only a first entry is accepted
 * (it scores from now on); a final or waiting stage accepts nothing.
 */
export async function saveLineup(opts: {
  managerId: string;
  eventId: number;
  stageId: number;
  lineup: unknown;
  teamName?: unknown;
  nowMs?: number;
}): Promise<SaveLineupResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const ctx = await loadFantasyContext(opts.eventId, nowMs);
  if (!ctx) return { ok: false, status: 404, error: "no_fantasy" };
  const view = ctx.stages.find((v) => v.stage.id === opts.stageId);
  if (!view) return { ok: false, status: 400, error: "unknown_stage" };
  const lineup = parseLineup(opts.lineup);
  if (!lineup) return { ok: false, status: 400, error: "invalid_lineup" };

  const existing = await prisma.fantasyLineup.findUnique({
    where: { playerId_eventId_stageId: { playerId: opts.managerId, eventId: opts.eventId, stageId: opts.stageId } },
    select: { id: true },
  });
  const action = lineupAction(view.phase, existing != null);
  if (action === "none") {
    return {
      ok: false,
      status: 409,
      error: view.phase === "waiting" ? "stage_not_open" : view.phase === "final" ? "stage_final" : "lineup_locked",
    };
  }
  const problems = validateLineup(lineup, view.pool);
  if (problems.length > 0) return { ok: false, status: 400, error: "illegal_lineup", problems };

  const data = { slots: JSON.stringify(lineup.slots), captainId: lineup.captainId, lockedAt: new Date(nowMs) };
  if (action === "join-late") {
    // create-only: a concurrent second request loses on the unique key, so a
    // live stage can never be edited by racing two saves.
    try {
      await prisma.fantasyLineup.create({
        data: { playerId: opts.managerId, eventId: opts.eventId, stageId: opts.stageId, ...data },
      });
    } catch {
      return { ok: false, status: 409, error: "lineup_locked" };
    }
  } else {
    await prisma.fantasyLineup.upsert({
      where: { playerId_eventId_stageId: { playerId: opts.managerId, eventId: opts.eventId, stageId: opts.stageId } },
      update: data,
      create: { playerId: opts.managerId, eventId: opts.eventId, stageId: opts.stageId, ...data },
    });
  }
  const name = cleanTeamName(opts.teamName);
  if (name) await saveTeamName(opts.managerId, opts.eventId, name);
  return { ok: true, lockedAtMs: nowMs, late: action === "join-late" };
}

export async function saveTeamName(managerId: string, eventId: number, rawName: unknown): Promise<string | null> {
  const name = cleanTeamName(rawName);
  if (!name) return null;
  await prisma.fantasyTeam.upsert({
    where: { playerId_eventId: { playerId: managerId, eventId } },
    update: { name },
    create: { playerId: managerId, eventId, name },
  });
  return name;
}

/* ── read models ──────────────────────────────────────────────────────── */

export interface ManagerRow extends StandingRow {
  displayName: string;
  avatarUrl: string | null;
  teamName: string | null;
  isSelf: boolean;
  /** Stage ids this manager has a lineup for. */
  entered: number[];
}

export interface FantasyBoard {
  ctx: FantasyContext;
  /** Overall standings across every stage. */
  overall: ManagerRow[];
  /** stage id -> standings for that stage (only managers who entered it). */
  byStage: Map<number, ManagerRow[]>;
  /** `${managerId}:${stageId}` -> the scored lineup. */
  scored: Map<string, { stored: StoredLineup; score: ScoredLineup }>;
  /** stage id -> HLTV player id -> share of that stage's lineups holding him (0-1). */
  ownership: Map<number, Map<number, number>>;
  /** stage id -> every player's raw output, best first. */
  playerTables: Map<number, PlayerStageLine[]>;
  teamNames: Map<string, string>;
  managers: number;
}

/** Score every lineup of an event and rank the managers. */
export async function buildFantasyBoard(eventId: number, selfId: string | null, nowMs: number = Date.now()): Promise<FantasyBoard | null> {
  const ctx = await loadFantasyContext(eventId, nowMs);
  if (!ctx) return null;
  const [lineups, teams] = await Promise.all([
    loadLineups(eventId),
    prisma.fantasyTeam.findMany({ where: { eventId }, select: { playerId: true, name: true } }),
  ]);
  const managerIds = [...new Set(lineups.map((l) => l.managerId))];
  const people = managerIds.length
    ? await prisma.player.findMany({
        where: { id: { in: managerIds } },
        select: { id: true, displayName: true, avatarUrl: true },
      })
    : [];
  const personOf = new Map(people.map((p) => [p.id, p]));
  const teamNames = new Map(teams.map((t) => [t.playerId, t.name]));
  const viewOf = new Map(ctx.stages.map((v) => [v.stage.id, v]));

  const scored = new Map<string, { stored: StoredLineup; score: ScoredLineup }>();
  const pointsBy = new Map<string, Record<number, number>>();
  const ownership = new Map<number, Map<number, number>>();
  const lineupCount = new Map<number, number>();
  for (const stored of lineups) {
    const view = viewOf.get(stored.stageId);
    if (!view || !personOf.has(stored.managerId)) continue;
    const score = scoreLineup(stored.lineup, stored.lockedAtMs, {
      stage: view.stage,
      stageStartMs: view.startMs,
      matches: view.matches,
      pool: view.pool,
    });
    scored.set(`${stored.managerId}:${stored.stageId}`, { stored, score });
    pointsBy.set(stored.managerId, { ...(pointsBy.get(stored.managerId) ?? {}), [stored.stageId]: score.total });
    lineupCount.set(stored.stageId, (lineupCount.get(stored.stageId) ?? 0) + 1);
    const own = ownership.get(stored.stageId) ?? new Map<number, number>();
    for (const s of stored.lineup.slots) own.set(s.playerId, (own.get(s.playerId) ?? 0) + 1);
    ownership.set(stored.stageId, own);
  }
  for (const [stageId, own] of ownership) {
    const n = lineupCount.get(stageId) ?? 1;
    for (const [pid, c] of own) own.set(pid, c / n);
  }

  const inputs = [...pointsBy.entries()].map(([managerId, byStage]) => ({ managerId, byStage }));
  const decorate = (rows: StandingRow[]): ManagerRow[] =>
    rows.map((r) => ({
      ...r,
      displayName: personOf.get(r.managerId)?.displayName ?? "Player",
      avatarUrl: personOf.get(r.managerId)?.avatarUrl ?? null,
      teamName: teamNames.get(r.managerId) ?? null,
      isSelf: r.managerId === selfId,
      entered: Object.keys(r.byStage).map(Number),
    }));
  const byStage = new Map<number, ManagerRow[]>();
  const playerTables = new Map<number, PlayerStageLine[]>();
  for (const v of ctx.stages) {
    byStage.set(v.stage.id, decorate(rankManagers(inputs.filter((i) => v.stage.id in i.byStage), v.stage.id)));
    playerTables.set(v.stage.id, playerStageTable(v.matches, v.startMs));
  }
  return {
    ctx,
    overall: decorate(rankManagers(inputs)),
    byStage,
    scored,
    ownership,
    playerTables,
    teamNames,
    managers: managerIds.length,
  };
}

/** What a manager may do with a stage now (for the page's action button). */
export function actionFor(view: StageView, hasLineup: boolean): LineupAction {
  return lineupAction(view.phase, hasLineup);
}

/** A team's standing in a stage, for the "is my player still in" chip. */
export function teamStanding(view: StageView, hltvTeamId: number | null): { record: string; status: "advanced" | "eliminated" | "alive" } {
  const rec = hltvTeamId != null ? view.records.get(hltvTeamId) : undefined;
  const status =
    view.stage.kind === "swiss"
      ? swissStatus(rec)
      : rec && rec.losses > 0
        ? "eliminated"
        : "alive";
  return { record: rec ? `${rec.wins}-${rec.losses}` : "0-0", status };
}
