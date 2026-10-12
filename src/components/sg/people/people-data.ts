/**
 * Read-only data helpers shared by the Singapore people screens (profile,
 * directory, majors). Every number here is computed with the exact maths the
 * pages already used — scorePlayer + the leaderboard's score-desc / name
 * tiebreak — so a Major's finish agrees with its leaderboard and its coin.
 * No writes, no schema, no crawl.
 */

import { prisma } from "@/lib/db";
import { getCommittedLayout, type Layout } from "@/lib/layout";
import { scorePlayer, type OutcomeMap, type PlayerPickMap } from "@/lib/scoring";
import { getEventBySlug, getEventConfig, type EventConfig } from "@/lib/events-core";
import { resolveEffectiveStatus } from "@/lib/event-lifecycle-core";
import { computeFinish, buildMajorsHistory, type MajorHistoryRow } from "@/lib/majors-core";
import { coinMintAtMs } from "@/lib/event-freeze";
import { deriveChallengeCoins, type ChallengeCoin } from "@/lib/challenge-coin-core";

/** Editorial dressing per Major: short name, photo and its credit line. */
const MAJOR_META: Record<string, { short: string; photo: string; credit: string }> = {
  "iem-cologne-2026": { short: "IEM Cologne 2026", photo: "/wrapped/major-champion.jpg", credit: "Photo · HLTV" },
  "pgl-singapore-2026": { short: "Singapore 2026", photo: "/wrapped/major-cover.jpg", credit: "Photo · HLTV" },
};

export function majorShortName(cfg: Pick<EventConfig, "slug" | "name">): string {
  return MAJOR_META[cfg.slug]?.short ?? cfg.name.replace(/\s+CS2 Major Championship$/i, "");
}

export function majorPhoto(slug: string): { src: string; credit: string } {
  const m = MAJOR_META[slug];
  return m ? { src: m.photo, credit: m.credit } : { src: "/wrapped/major-cover.jpg", credit: "Photo · HLTV" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Jun 2026" from an ISO date. */
export function monthYear(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** "25 Nov" from an ISO date — UTC, or in `timeZone` when given. */
export function dayMonth(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (timeZone) return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(d);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function ordSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

/**
 * Resolve the Major a read-only view was asked for: `?major=<slug>` or
 * `?event=<id>` when registered, else null (caller falls back to the default).
 */
export function requestedEvent(sp: { [key: string]: string | string[] | undefined }): EventConfig | null {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const slug = first(sp.major);
  if (slug) {
    const bySlug = getEventBySlug(slug);
    if (bySlug) return bySlug;
  }
  const id = Number(first(sp.event));
  if (Number.isInteger(id)) return getEventConfig(id);
  return null;
}

/** The layout fixture that describes a given event, or null if not loadable. */
function layoutFor(eventId: number): Layout | null {
  const committed = getCommittedLayout();
  return committed.event === eventId ? committed : null;
}

/** One Major's whole field, scored and ranked exactly like its leaderboard. */
export interface MajorField {
  eventId: number;
  scored: boolean;
  /** Player ids best-first (score desc, then displayName asc). */
  ranked: string[];
  scoreById: Record<string, number>;
  /** Non-cleared pick count per player. */
  pickCountById: Record<string, number>;
}

export async function scoreMajorField(eventId: number): Promise<MajorField> {
  const layout = layoutFor(eventId);
  const [allPicks, outcomes] = await Promise.all([
    prisma.pick.findMany({
      where: { eventId },
      include: { player: { select: { displayName: true } } },
    }),
    prisma.stageOutcome.findMany({ where: { eventId } }),
  ]);

  const outcomeMap: OutcomeMap = {};
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }

  const pickMap: PlayerPickMap = {};
  const nameById: Record<string, string> = {};
  const pickCountById: Record<string, number> = {};
  for (const p of allPicks) {
    pickMap[p.playerId] ??= {};
    pickMap[p.playerId][p.sectionId] ??= {};
    pickMap[p.playerId][p.sectionId][p.groupId] ??= {};
    pickMap[p.playerId][p.sectionId][p.groupId][p.slotIndex] = p.pickId;
    nameById[p.playerId] = p.player.displayName;
    pickCountById[p.playerId] ??= 0;
    if (p.pickId !== 0) pickCountById[p.playerId]++;
  }

  const playerIds = Object.keys(pickMap);
  const scoreById: Record<string, number> = {};
  for (const pid of playerIds) {
    scoreById[pid] = layout ? scorePlayer(layout, pickMap[pid], outcomeMap).total : 0;
  }
  const ranked = [...playerIds].sort(
    (a, b) => scoreById[b] - scoreById[a] || (nameById[a] ?? "").localeCompare(nameById[b] ?? ""),
  );
  return { eventId, scored: layout != null, ranked, scoreById, pickCountById };
}

/**
 * Every Major `playerId` has played (distinct eventIds in their picks the
 * registry knows), newest first — the same rows /majors always showed, with the
 * status resolved from the clock so a concluded Major reads as Final.
 */
export async function playerMajorsHistory(playerId: string, nowMs: number): Promise<MajorHistoryRow[]> {
  const playedRows = await prisma.pick.findMany({
    where: { playerId },
    distinct: ["eventId"],
    select: { eventId: true },
  });
  const rows: MajorHistoryRow[] = [];
  for (const { eventId } of playedRows) {
    const cfg = getEventConfig(eventId);
    if (!cfg) continue;
    const field = await scoreMajorField(eventId);
    rows.push({
      eventId,
      slug: cfg.slug,
      name: cfg.name,
      status: resolveEffectiveStatus(cfg, nowMs),
      start: cfg.dates.start,
      scored: field.scored,
      score: field.scored ? field.scoreById[playerId] ?? 0 : 0,
      finish: field.scored ? computeFinish(playerId, field.ranked) : null,
      fieldSize: field.ranked.length,
      pickCount: field.pickCountById[playerId] ?? 0,
    });
  }
  return buildMajorsHistory(rows);
}

/**
 * The directory's per-player view of one concluded Major: each player's finish
 * and the challenge coin it minted (same earn rule + tiering as the profile
 * shelf, via deriveChallengeCoins). Null while the Major hasn't concluded.
 */
export async function majorFinishesAndCoins(
  cfg: EventConfig,
  nowMs: number,
): Promise<{ fieldSize: number; finishById: Map<string, number>; coinById: Map<string, ChallengeCoin> } | null> {
  const mintedAt = await coinMintAtMs(cfg.eventId, nowMs);
  if (mintedAt === null) return null;
  const field = await scoreMajorField(cfg.eventId);
  const finishById = new Map<string, number>();
  const coinById = new Map<string, ChallengeCoin>();
  field.ranked.forEach((pid, i) => {
    if (field.scored) finishById.set(pid, i + 1);
    const [coin] = deriveChallengeCoins([
      {
        eventId: cfg.eventId,
        slug: cfg.slug,
        name: cfg.name,
        archived: true,
        participated: (field.pickCountById[pid] ?? 0) > 0,
        scored: field.scored,
        finish: field.scored ? i + 1 : null,
        fieldSize: field.ranked.length,
        earnedAtMs: mintedAt,
      },
    ]);
    if (coin) coinById.set(pid, coin);
  });
  return { fieldSize: field.ranked.length, finishById, coinById };
}
