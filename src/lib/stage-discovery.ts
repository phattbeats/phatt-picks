/**
 * Stage discovery: the I/O half (PHA-5358). See stage-discovery-core.ts for the
 * model and docs/AUTOPILOT.md for the operator's view.
 *
 * - `recordStagePage` runs on every HLTV stage-page crawl (the standings
 *   ingest already fetches these pages). It stores the page's own facts
 *   (earliest published match, header span) and the sibling stage pages it
 *   links, for Swiss sections with no committed source.
 * - `loadStageFacts` reads the table and installs the overlay
 *   (`setStageFacts`), so every registry read follows HLTV.
 *
 * Best-effort throughout: a DB hiccup leaves the previous overlay (or the
 * committed config) in place and never throws into a tick or a render.
 */

import { prisma } from "./db";
import { BASE_EVENTS, playoffSectionIdsFor, setStageFacts } from "./events-core";
import {
  mergePlayoffProposal,
  parseHltvMatchList,
  proposePlayoffSchedule,
} from "./playoff-schedule-core";
import {
  linkStagesToSections,
  nextFirstMatchAt,
  parseHltvEventPage,
  stageFactsFromPage,
  type StageFacts,
} from "./stage-discovery-core";
import type { RawSwissRound } from "./swiss-bracket-core";

const toDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);
const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function parseGameTimes(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) && v.every((t) => typeof t === "string") ? (v as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Load every persisted stage fact and install the overlay. Returns the number
 * of events whose effective config changed. Never throws.
 */
export async function loadStageFacts(): Promise<number> {
  let rows;
  try {
    rows = await prisma.stageDiscovery.findMany();
  } catch {
    return 0; // table absent before the first db push, or a DB hiccup
  }
  const byEvent = new Map<number, StageFacts[]>();
  for (const r of rows) {
    const list = byEvent.get(r.eventId) ?? [];
    list.push({
      sectionId: r.sectionId,
      sourceUrl: r.sourceUrl,
      firstMatchAt: toIso(r.firstMatchAt),
      windowStart: toIso(r.windowStart),
      windowEnd: toIso(r.windowEnd),
      gameTimes: parseGameTimes(r.gameTimes),
    });
    byEvent.set(r.eventId, list);
  }
  let changed = 0;
  for (const eventId of Object.keys(BASE_EVENTS).map(Number)) {
    if (setStageFacts(eventId, byEvent.get(eventId) ?? [])) {
      changed++;
      const facts = (byEvent.get(eventId) ?? []).filter((f) => f.firstMatchAt);
      console.log(
        `[stage-discovery] event ${eventId}: overlay now ` +
          (facts.map((f) => `${f.sectionId}@${f.firstMatchAt}`).join(", ") || "empty"),
      );
    }
  }
  return changed;
}

/**
 * Persist what one crawl of a stage page says. A crawl that parses no timed
 * matchup never clears a previously published first match (a transient parse
 * miss must not re-darken a stage), and once that first match has passed it
 * is frozen (`nextFirstMatchAt`). Linked sibling pages are recorded only for
 * Swiss sections with no committed source, and never replace a row that
 * already has a published first match. Reloads the overlay afterwards.
 */
export async function recordStagePage(
  eventId: number,
  sectionId: number,
  sourceUrl: string,
  html: string,
  bracket: readonly RawSwissRound[],
): Promise<void> {
  const base = BASE_EVENTS[eventId];
  if (!base) return;
  try {
    const page = parseHltvEventPage(html);
    const own = stageFactsFromPage(sectionId, sourceUrl, page, bracket);
    const prior = await prisma.stageDiscovery.findUnique({
      where: { eventId_sectionId: { eventId, sectionId } },
    });
    const firstMs = nextFirstMatchAt(
      prior?.firstMatchAt?.getTime() ?? null,
      own.firstMatchAt ? Date.parse(own.firstMatchAt) : null,
      Date.now(),
    );
    const firstMatchAt = firstMs === null ? null : new Date(firstMs);
    const data = {
      sourceUrl,
      firstMatchAt,
      windowStart: toDate(own.windowStart) ?? prior?.windowStart ?? null,
      windowEnd: toDate(own.windowEnd) ?? prior?.windowEnd ?? null,
      checkedAt: new Date(),
    };
    await prisma.stageDiscovery.upsert({
      where: { eventId_sectionId: { eventId, sectionId } },
      update: data,
      create: { eventId, sectionId, ...data },
    });

    for (const [linkedSection, link] of linkStagesToSections(base.sectionNames, page.linked)) {
      if (linkedSection === sectionId || base.sectionSources[linkedSection]) continue;
      const existing = await prisma.stageDiscovery.findUnique({
        where: { eventId_sectionId: { eventId, sectionId: linkedSection } },
      });
      if (existing && (existing.firstMatchAt || existing.sourceUrl === link.url)) continue;
      await prisma.stageDiscovery.upsert({
        where: { eventId_sectionId: { eventId, sectionId: linkedSection } },
        update: { sourceUrl: link.url, firstMatchAt: null, windowStart: null, windowEnd: null },
        create: { eventId, sectionId: linkedSection, sourceUrl: link.url },
      });
      console.log(`[stage-discovery] event ${eventId}: section ${linkedSection} → ${link.url} ("${link.title}")`);
    }
  } catch (e) {
    console.warn("[stage-discovery] record failed (non-fatal):", e instanceof Error ? e.message : e);
    return;
  }
  await loadStageFacts();
}

/**
 * Discovered stage pages the standings crawl does not cover yet: rows whose
 * section has no source in the effective config (no published timed matchup,
 * so the overlay has not added it). These are the pages the hourly discovery
 * pass crawls to catch the moment HLTV publishes a stage.
 */
export async function pendingStagePages(
  eventId: number,
  effectiveSources: Readonly<Record<number, unknown>>,
): Promise<{ sectionId: number; sourceUrl: string }[]> {
  try {
    const playoff = BASE_EVENTS[eventId] ? playoffSectionIdsFor(BASE_EVENTS[eventId]) : new Set<number>();
    const rows = await prisma.stageDiscovery.findMany({ where: { eventId } });
    return rows
      .filter((r) => !playoff.has(r.sectionId)) // playoff rows are match-list facts, not stage pages
      .filter((r) => !(r.sectionId in effectiveSources))
      .map((r) => ({ sectionId: r.sectionId, sourceUrl: r.sourceUrl }));
  } catch {
    return [];
  }
}

/**
 * Persist what one crawl of an HLTV event match list says about the playoff
 * bracket (PHA-5276). Rules, all from `mergePlayoffProposal`:
 *   - a round is written only when HLTV lists every game of it with a time;
 *   - a round with committed games is never written (committed wins);
 *   - once the effective bracket has locked nothing is written (frozen), so a
 *     late HLTV edit can't move a locked bracket.
 * A crawl that proposes nothing never clears a stored round. Reloads the
 * overlay afterwards. Never throws. Returns the sections written.
 */
export async function recordPlayoffMatchList(
  eventId: number,
  sourceUrl: string,
  html: string,
  nowMs: number = Date.now(),
): Promise<number[]> {
  const base = BASE_EVENTS[eventId];
  if (!base) return [];
  const written: number[] = [];
  try {
    const playoff = playoffSectionIdsFor(base);
    const proposal = proposePlayoffSchedule(parseHltvMatchList(html), base.sectionNames);
    const rows = await prisma.stageDiscovery.findMany({ where: { eventId } });
    const stored: Record<number, string[]> = {};
    for (const r of rows) {
      const t = playoff.has(r.sectionId) ? parseGameTimes(r.gameTimes) : null;
      if (t && t.length > 0) stored[r.sectionId] = t;
    }
    const merged = mergePlayoffProposal({
      committed: base.playoffSchedule,
      previous: { ...stored, ...nonEmpty(base.playoffSchedule) },
      proposal,
      nowMs,
    });
    for (const [key, times] of Object.entries(merged)) {
      const sectionId = Number(key);
      if (!playoff.has(sectionId)) continue;
      if ((base.playoffSchedule[sectionId]?.length ?? 0) > 0) continue; // committed
      if (JSON.stringify(stored[sectionId] ?? null) === JSON.stringify(times)) continue;
      const first = [...times].sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
      const data = {
        sourceUrl,
        firstMatchAt: toDate(first),
        gameTimes: JSON.stringify(times),
        checkedAt: new Date(),
      };
      await prisma.stageDiscovery.upsert({
        where: { eventId_sectionId: { eventId, sectionId } },
        update: data,
        create: { eventId, sectionId, ...data },
      });
      written.push(sectionId);
      console.log(`[playoff-discovery] event ${eventId}: section ${sectionId} → ${times.join(", ")}`);
    }
  } catch (e) {
    console.warn("[playoff-discovery] record failed (non-fatal):", e instanceof Error ? e.message : e);
    return written;
  }
  if (written.length > 0) await loadStageFacts();
  return written;
}

/** Discovered page per section (sourceUrl), for finding the hub before it is sourced. */
export async function discoveredStagePages(eventId: number): Promise<Record<number, string>> {
  try {
    const rows = await prisma.stageDiscovery.findMany({ where: { eventId } });
    return Object.fromEntries(rows.map((r) => [r.sectionId, r.sourceUrl]));
  } catch {
    return {};
  }
}

function nonEmpty(s: Readonly<Record<number, readonly string[]>>): Record<number, readonly string[]> {
  return Object.fromEntries(Object.entries(s).filter(([, t]) => t.length > 0));
}
