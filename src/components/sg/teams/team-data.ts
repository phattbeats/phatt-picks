/**
 * Read-side data for /teams/[slug] (prototype 05). Server-only: reads the
 * committed layout, the StageOutcome answer key and Pick rows. Never writes.
 *
 * The page describes a team at the Major whose layout fixture is committed
 * (getCommittedLayout().event) — today that's Cologne; when the Singapore
 * layout lands the page follows it with no code change.
 *
 * Community pick share follows the reveal-core discipline: a stage's calls are
 * aggregated only once that stage is locked/revealed (or the Major is archived),
 * exactly like the reveal and player pages.
 */

import { prisma } from "@/lib/db";
import { getCommittedLayout, type Layout, type Section, type TeamDef } from "@/lib/layout";
import { getEventConfig } from "@/lib/events-core";
import { isRevealForcedById } from "@/lib/event-freeze";
import { isLockTimePassed } from "@/lib/lock-schedule-core";
import { arePicksRevealed } from "@/lib/reveal-core";
import { bucketSwissSlots, isSwissSection, resolveBucketWinners } from "@/lib/swiss-bucket-core";
import { PLAYOFF_ROUNDS } from "@/lib/playoff-bracket-core";
import { statsForPickid, TEAM_STATS_AS_OF, type TeamStats } from "@/lib/team-stats-core";
import { getLiveTeamStats } from "@/lib/team-stats";
import { regionMetaForPickid, type RegionMeta } from "@/lib/regions-core";
import { teamSlug } from "./team-assets";

export type SwissResult = "3-0" | "adv" | "0-3" | "out" | null;

export interface StageCall {
  sectionId: number;
  stage: string; // "Stage I"
  /** The team's actual bucket once resolved, else null (in play). */
  result: SwissResult;
  /** null until the stage's picks are revealed (locked / archived). */
  share: { total: number; threeZero: number; advance: number; zeroThree: number; notPicked: number } | null;
}

export type Finish =
  | { kind: "champion" }
  | { kind: "runner-up" }
  | { kind: "final" } // in the GF, unresolved
  | { kind: "semis"; out: boolean }
  | { kind: "quarters"; out: boolean }
  | { kind: "swiss-out"; stage: string }
  | { kind: "swiss-live"; stage: string }
  | { kind: "unknown" };

export interface TeamPageData {
  team: TeamDef;
  field: TeamDef[];
  eventId: number;
  eventCity: string;
  eventShort: string;
  region: RegionMeta | null;
  stats: TeamStats | null;
  statsAsOf: string;
  stages: StageCall[];
  finish: Finish;
  /** Share of the room that crowned this team champion (revealed only). */
  championShare: { count: number; total: number } | null;
}

const CITY_BY_EVENT: Record<number, string> = { 26: "Cologne", 27: "Singapore" };

/** Resolve a URL slug to a layout team (HLTV slug, name slug or logo key). */
export function findTeamBySlug(layout: Layout, slug: string): TeamDef | null {
  const s = decodeURIComponent(slug).toLowerCase();
  return (
    layout.teams.find((t) => t.pickid > 0 && teamSlug(t) === s) ??
    layout.teams.find((t) => t.pickid > 0 && t.logo.toLowerCase() === s) ??
    null
  );
}

/** Every real team in the committed field, in layout order. */
export function fieldTeams(layout: Layout): TeamDef[] {
  return layout.teams.filter((t) => t.pickid > 0);
}

export async function loadTeamPage(slug: string, nowMs: number): Promise<TeamPageData | null> {
  const layout = getCommittedLayout();
  const team = findTeamBySlug(layout, slug);
  if (!team) return null;

  const eventId = layout.event;
  const event = getEventConfig(eventId);
  const pid = team.pickid;

  const [outcomeRows, live, archived] = await Promise.all([
    prisma.stageOutcome
      .findMany({
        where: { eventId },
        select: { sectionId: true, groupId: true, slotIndex: true, winnerPickId: true },
      })
      .catch(() => []),
    getLiveTeamStats(eventId),
    isRevealForcedById(eventId, nowMs).catch(() => false),
  ]);

  // sectionId:groupId → slotIndex → winner
  const outcomes = new Map<string, Record<number, number>>();
  for (const o of outcomeRows) {
    const k = `${o.sectionId}:${o.groupId}`;
    const m = outcomes.get(k) ?? {};
    m[o.slotIndex] = o.winnerPickId;
    outcomes.set(k, m);
  }
  const groupOutcomes = (s: Section, g: Section["groups"][number]) => outcomes.get(`${s.sectionid}:${g.groupid}`) ?? {};
  const isRevealed = (s: Section) => {
    const g = s.groups[0];
    if (!g) return false;
    const hasOutcome = Object.keys(groupOutcomes(s, g)).length > 0;
    return arePicksRevealed(g, hasOutcome, isLockTimePassed(s.sectionid, nowMs, event?.lockSchedule), archived);
  };

  // ── Swiss run: entry stage, then onward only while the team advances ──
  const swiss = layout.sections.filter((s) => isSwissSection(s.sectionid));
  const played: Array<{ section: Section; result: SwissResult }> = [];
  let entered = false;
  for (const s of swiss) {
    const g = s.groups[0];
    if (!g) continue;
    if (!entered) {
      if (!g.teams.some((t) => t.pickid === pid)) continue;
      entered = true;
    }
    const buckets = bucketSwissSlots(g.picks.length);
    const go = groupOutcomes(s, g);
    const won = buckets.map((b) => resolveBucketWinners(b.slotIndexes, go));
    let result: SwissResult = null;
    if (buckets.length === 3) {
      if (won[0].winners.has(pid)) result = "3-0";
      else if (won[1].winners.has(pid)) result = "adv";
      else if (won[2].winners.has(pid)) result = "0-3";
      else if (won.every((w) => w.fullyResolved)) result = "out";
    }
    played.push({ section: s, result });
    if (result !== "3-0" && result !== "adv") break; // out, or still in play
  }

  // ── Playoffs ──
  const sectionById = new Map(layout.sections.map((s) => [s.sectionid, s]));
  const qf = sectionById.get(PLAYOFF_ROUNDS[0].sectionId);
  const sf = sectionById.get(PLAYOFF_ROUNDS[1].sectionId);
  const gf = sectionById.get(PLAYOFF_ROUNDS[2].sectionId);
  const winnerOf = (s: Section | undefined, i: number) => {
    const g = s?.groups[i];
    if (!s || !g) return 0;
    return groupOutcomes(s, g)[0] ?? 0;
  };
  const lastSwiss = played[played.length - 1];
  const qfIdx = qf ? qf.groups.findIndex((g) => g.teams.some((t) => t.pickid === pid)) : -1;
  const advancedFromSwiss =
    lastSwiss?.section.sectionid === swiss[swiss.length - 1]?.sectionid &&
    (lastSwiss.result === "3-0" || lastSwiss.result === "adv");
  const inPlayoffs = qfIdx >= 0 || advancedFromSwiss;

  let finish: Finish = { kind: "unknown" };
  if (inPlayoffs) {
    const gfWinner = winnerOf(gf, 0);
    const sfWinners = sf ? sf.groups.map((_, i) => winnerOf(sf, i)) : [];
    const qfWinner = qfIdx >= 0 ? winnerOf(qf, qfIdx) : 0;
    if (gfWinner === pid) finish = { kind: "champion" };
    else if (sfWinners.includes(pid)) finish = gfWinner ? { kind: "runner-up" } : { kind: "final" };
    else if (qfWinner === pid) {
      const sfOut = sfWinners[Math.floor(qfIdx / 2)] ?? 0;
      finish = { kind: "semis", out: sfOut !== 0 };
    } else finish = { kind: "quarters", out: qfWinner !== 0 };
  } else if (lastSwiss) {
    const stage = lastSwiss.section.name.split(" | ")[0];
    finish =
      lastSwiss.result === "out" || lastSwiss.result === "0-3"
        ? { kind: "swiss-out", stage }
        : { kind: "swiss-live", stage };
  }

  // ── Community pick share (revealed stages only) ──
  const revealedSwiss = played.filter((p) => isRevealed(p.section)).map((p) => p.section.sectionid);
  const gfRevealed = gf && inPlayoffs && isRevealed(gf) ? gf.sectionid : null;
  const shareIds = gfRevealed != null ? [...revealedSwiss, gfRevealed] : revealedSwiss;
  const rows =
    shareIds.length > 0
      ? await prisma.pick
          .findMany({
            where: { eventId, sectionId: { in: shareIds }, pickId: { not: 0 } },
            select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
          })
          .catch(() => [])
      : [];

  const stages: StageCall[] = played.map(({ section, result }) => {
    const stage = section.name.split(" | ")[0];
    if (!revealedSwiss.includes(section.sectionid)) return { sectionId: section.sectionid, stage, result, share: null };
    const g = section.groups[0];
    const buckets = bucketSwissSlots(g.picks.length);
    const everyone = new Set<string>();
    const byBucket = buckets.map(() => new Set<string>());
    for (const r of rows) {
      if (r.sectionId !== section.sectionid || r.groupId !== g.groupid) continue;
      everyone.add(r.playerId);
      if (r.pickId !== pid) continue;
      const bi = buckets.findIndex((b) => b.slotIndexes.includes(r.slotIndex));
      if (bi >= 0) byBucket[bi].add(r.playerId);
    }
    const total = everyone.size;
    if (total === 0 || buckets.length !== 3) return { sectionId: section.sectionid, stage, result, share: null };
    const [threeZero, advance, zeroThree] = byBucket.map((b) => b.size);
    return {
      sectionId: section.sectionid,
      stage,
      result,
      share: { total, threeZero, advance, zeroThree, notPicked: Math.max(0, total - threeZero - advance - zeroThree) },
    };
  });

  let championShare: TeamPageData["championShare"] = null;
  if (gfRevealed != null && gf?.groups[0]) {
    const gid = gf.groups[0].groupid;
    const all = new Set<string>();
    const mine = new Set<string>();
    for (const r of rows) {
      if (r.sectionId !== gfRevealed || r.groupId !== gid) continue;
      all.add(r.playerId);
      if (r.pickId === pid) mine.add(r.playerId);
    }
    if (all.size > 0) championShare = { count: mine.size, total: all.size };
  }

  const stats = live?.byPickid[pid] ?? statsForPickid(pid);
  const eventName = event?.name ?? layout.name;

  return {
    team,
    field: fieldTeams(layout),
    eventId,
    eventCity: CITY_BY_EVENT[eventId] ?? eventName,
    eventShort: eventName.replace(/\s+CS2 Major Championship$/i, ""),
    region: regionMetaForPickid(pid),
    stats,
    statsAsOf: (live?.byPickid[pid] && live.asOf) || TEAM_STATS_AS_OF,
    stages,
    finish,
    championShare,
  };
}

