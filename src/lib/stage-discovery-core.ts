/**
 * Stage discovery: the pure half (PHA-5358).
 *
 * A Major's per-stage schedule used to arrive as a hand-written commit: the
 * first-match instant, the play window and the HLTV page for each Swiss stage.
 * That broke twice in the same way. Stage III stayed dark until someone
 * noticed, and Singapore's Stage I lock was copied from HLTV's event-day marker
 * (11:00Z) when the real first match is 04:00Z.
 *
 * HLTV already publishes all three facts on pages we crawl:
 *   - each stage page's group table carries every scheduled match with its
 *     unix start time (`data-unix`), so the earliest published match is the
 *     stage's lock;
 *   - the page header carries the stage's date span (the crawl window);
 *   - the "Grouped events" strip links every sibling stage page ("Stage 2",
 *     "Stage 3 & Playoffs"), which is how a stage with no committed source is
 *     found.
 *
 * This module reads those facts. `mergeStageFacts` (events-core) overlays them
 * on the committed registry, so every consumer of `lockSchedule` /
 * `matchWindows` / `sectionSources` follows HLTV with no code edit.
 *
 * Rule: nothing here estimates a time. A stage whose matchups or times are not
 * published yields `firstMatchAt: null` and stays dark.
 *
 * Pure: no prisma, no fetch, no `@/` alias, so scripts/verify-stage-discovery.ts
 * runs it under `node --experimental-strip-types`.
 */

import type { RawSwissRound } from "./swiss-bracket-core";

/** A sibling stage page HLTV links from the "Grouped events" strip. */
export interface LinkedStage {
  eventId: number;
  /** Absolute HLTV event url. */
  url: string;
  /** HLTV's short title, e.g. "Stage 2", "Stage 3 & Playoffs". */
  title: string;
  /** Swiss stage numbers the title covers ("Stage 3 & Playoffs" -> [3]). */
  stages: number[];
  startMs: number | null;
  endMs: number | null;
}

/** What one crawled HLTV event page says about its own stage. */
export interface HltvEventPageFacts {
  /** HLTV event id of the page itself, when the header names it. */
  eventId: number | null;
  /** The page's own title ("PGL Major Singapore 2026 Stage 1"). */
  title: string | null;
  /** Header date span (day markers, not match times). */
  dateStartMs: number | null;
  dateEndMs: number | null;
  linked: LinkedStage[];
}

/** The overlay record for one section, as persisted and as merged. */
export interface StageFacts {
  sectionId: number;
  /** HLTV page that carries this stage's Swiss bracket. */
  sourceUrl: string;
  /** Earliest published match start (ISO), or null while none is published. */
  firstMatchAt: string | null;
  /** Crawl window from the page header (ISO), or null when unknown. */
  windowStart: string | null;
  windowEnd: string | null;
  /**
   * Playoff sections only (PHA-5276): HLTV's per-game start instants (ISO,
   * bracket order) from the event match list. Absent / null for Swiss rows.
   */
  gameTimes?: readonly string[] | null;
}

const HLTV_ORIGIN = "https://www.hltv.org";

/**
 * HLTV's header end marker is a calendar day pinned to a fixed hour, not the
 * last match. The crawl window keeps running one day past it so a late final
 * round is still read. This is a crawl stop, never shown as a time.
 */
export const WINDOW_END_GRACE_MS = 24 * 60 * 60_000;

const ROMAN: Readonly<Record<string, number>> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };

/** "Stage III" / "Stage 3" -> 3; anything else -> null. */
export function stageNumberOfSection(name: string): number | null {
  const m = name.trim().match(/^stage\s+([ivx]+|\d+)\b/i);
  if (!m) return null;
  const tok = m[1].toLowerCase();
  if (/^\d+$/.test(tok)) return Number(tok);
  return ROMAN[tok] ?? null;
}

/** Every "Stage N" a title mentions: "Stage 3 & Playoffs" -> [3]; "Stages 1-2" is not a format HLTV uses. */
export function stageNumbersFromTitle(title: string): number[] {
  const out: number[] = [];
  for (const m of title.matchAll(/\bstage\s+([ivx]+|\d+)\b/gi)) {
    const n = stageNumberOfSection(`Stage ${m[1]}`);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function unixPair(fragment: string): { startMs: number | null; endMs: number | null } {
  const ts = [...fragment.matchAll(/data-unix="(\d+)"/g)].map((m) => Number(m[1]));
  return { startMs: ts[0] ?? null, endMs: ts[1] ?? ts[0] ?? null };
}

const LINKED_RE =
  /<a href="(\/events\/(\d+)\/[^"]*)" class="a-reset linked-event"[\s\S]*?linked-event-title">([^<]*)<\/div>\s*<div class="linked-event-info">([\s\S]*?)<\/div>/g;
const HUB_TOP_RE = /<a href="\/events\/(\d+)\/[^"]*" class="event-hub-top">[\s\S]*?event-hub-title">([^<]*)</;
const EVENT_DATE_RE = /<td class="eventdate">([\s\S]*?)<\/td>/;

/**
 * Read the header of an HLTV event page: its own id/title, its date span and
 * the sibling stages it links. Never throws; missing parts come back null/[].
 */
export function parseHltvEventPage(html: string): HltvEventPageFacts {
  const top = html.match(HUB_TOP_RE);
  const date = html.match(EVENT_DATE_RE);
  const span = date ? unixPair(date[1]) : { startMs: null, endMs: null };
  const linked: LinkedStage[] = [];
  const seen = new Set<number>();
  for (const m of html.matchAll(LINKED_RE)) {
    const eventId = Number(m[2]);
    if (seen.has(eventId)) continue;
    seen.add(eventId);
    const title = decode(m[3]);
    linked.push({
      eventId,
      url: HLTV_ORIGIN + m[1],
      title,
      stages: stageNumbersFromTitle(title),
      ...unixPair(m[4]),
    });
  }
  return {
    eventId: top ? Number(top[1]) : null,
    title: top ? decode(top[2]) : null,
    dateStartMs: span.startMs,
    dateEndMs: span.endMs,
    linked,
  };
}

/**
 * The earliest start time among published matchups: a match counts only when
 * both teams are named and HLTV gives it a start time. Null when nothing is
 * published (an empty bracket, TBD slots, or matchups with no times yet).
 */
export function firstPublishedMatchMs(rounds: readonly RawSwissRound[]): number | null {
  let best: number | null = null;
  for (const r of rounds) {
    for (const m of r.matches) {
      if (!m.team1.name || !m.team2.name || m.startTimeMs === null) continue;
      if (best === null || m.startTimeMs < best) best = m.startTimeMs;
    }
  }
  return best;
}

/** True once at least one matchup has both teams named (the bracket is worth showing). */
export function hasPublishedMatchups(rounds: readonly { matches: readonly { team1: { name: string | null }; team2: { name: string | null } }[] }[]): boolean {
  return rounds.some((r) => r.matches.some((m) => !!m.team1.name && !!m.team2.name));
}

const iso = (ms: number | null): string | null => (ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString());

/**
 * The facts one crawl of a stage page yields for its section: the earliest
 * published match (lock), and the header span (crawl window, end + grace).
 */
export function stageFactsFromPage(
  sectionId: number,
  sourceUrl: string,
  page: HltvEventPageFacts,
  rounds: readonly RawSwissRound[],
): StageFacts {
  const first = firstPublishedMatchMs(rounds);
  return {
    sectionId,
    sourceUrl,
    firstMatchAt: iso(first),
    windowStart: iso(page.dateStartMs !== null && first !== null ? Math.min(page.dateStartMs, first) : (page.dateStartMs ?? first)),
    windowEnd: iso(page.dateEndMs === null ? null : page.dateEndMs + WINDOW_END_GRACE_MS),
  };
}

/**
 * Which unsourced Swiss sections a crawled page's sibling links can fill:
 * section name "Stage III" pairs with a linked title mentioning "Stage 3".
 * Returns sectionId -> linked stage. Sections that already have a source are
 * skipped by the caller, never overwritten here.
 */
export function linkStagesToSections(
  sectionNames: Readonly<Record<number, string>>,
  linked: readonly LinkedStage[],
): Map<number, LinkedStage> {
  const out = new Map<number, LinkedStage>();
  for (const [key, name] of Object.entries(sectionNames)) {
    const n = stageNumberOfSection(name);
    if (n === null) continue;
    const hit = linked.find((l) => l.stages.includes(n));
    if (hit) out.set(Number(key), hit);
  }
  return out;
}

/**
 * Whether the picks page shows a Swiss stage's live bracket + standings
 * (PHA-5358, extending #943). Any one of:
 *   - the stage is locked (the post-lock lineup always carries it);
 *   - the clock reveal (`lockAt − 24h`) has passed;
 *   - HLTV has published at least one named matchup for it.
 * Never for a playoff section (those have their own tree).
 */
export function liveBracketVisible(input: {
  isSwiss: boolean;
  locked: boolean;
  revealedByClock: boolean;
  publishedMatchups: boolean;
}): boolean {
  return input.isSwiss && (input.locked || input.revealedByClock || input.publishedMatchups);
}
