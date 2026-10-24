/**
 * PHATT ID progression for Hotline (PHA-4477) — server-side assembly.
 *
 * Gathers one player's facts per Major from what Hotline already stores (picks,
 * outcomes, rank snapshots, seals, reactions) and hands them to the pure
 * progression-core. Read-only: nothing is written except the cosmetic loadout,
 * so Cologne backfills itself and every surface agrees.
 *
 * Cost: a Major's field is scored once (two queries) and memoised for 30s, so
 * the profile, the bell and the SSE stream share it. A Major without a layout
 * (the next one, before Valve opens it) contributes nothing.
 */

import { prisma } from "./db";
import { getEffectiveLayout } from "./layout-state";
import type { Layout } from "./layout";
import { scorePlayer, type OutcomeMap, type PlayerPickMap } from "./scoring";
import { getEventConfig } from "./events-core";
import { lockTimeForSection } from "./lock-schedule-core";
import { bucketSwissSlots, isSwissSection } from "./swiss-bucket-core";
import { coinMintAtMs } from "./event-freeze";
import { ACHIEVEMENTS_LAUNCH_MS } from "./notifications-core";

/** The feed entry for the PHATT ID welcome (the Cologne haul); /phatt-id marks it read. */
export const WELCOME_ENTRY_ID = "ach:launch";
import {
  evaluateAchievements,
  ledgerFor,
  ledgerTotal,
  levelForXp,
  parseLoadout,
  effectiveLoadout,
  FELTS,
  type AchievementKey,
  type FeltDef,
  type LedgerRow,
  type Loadout,
  type MajorFact,
  type PlayerFacts,
  type StageFact,
  type Unlock,
} from "./progression-core";

/** A stage as the site shows it: one Swiss section, or every playoff section together. */
interface StageShape {
  stageId: number;
  isPlayoffs: boolean;
  sectionIds: number[];
  slotCount: number;
}

function stagesOf(layout: Layout): StageShape[] {
  const swiss: StageShape[] = [];
  const playoffs: StageShape = { stageId: 0, isPlayoffs: true, sectionIds: [], slotCount: 0 };
  for (const s of [...layout.sections].sort((a, b) => a.sectionid - b.sectionid)) {
    const slots = s.groups.reduce((n, g) => n + g.picks.length, 0);
    if (isSwissSection(s.sectionid)) {
      swiss.push({ stageId: s.sectionid, isPlayoffs: false, sectionIds: [s.sectionid], slotCount: slots });
    } else {
      if (playoffs.sectionIds.length === 0) playoffs.stageId = s.sectionid;
      playoffs.sectionIds.push(s.sectionid);
      playoffs.slotCount += slots;
    }
  }
  return playoffs.sectionIds.length > 0 ? [...swiss, playoffs] : swiss;
}

/** One Major's field, scored once and shared by every player's facts. */
interface Field {
  layout: Layout;
  stages: StageShape[];
  pickMap: PlayerPickMap;
  outcomeMap: OutcomeMap;
  /** Resolved slot count and latest resolve instant per section. */
  resolvedCount: Map<number, number>;
  resolvedAt: Map<number, number>;
  /** points per player per section. */
  pointsBySection: Map<string, Map<number, number>>;
}

const FIELD_TTL_MS = 30_000;
const fieldMemo = new Map<number, { at: number; field: Promise<Field | null> }>();

async function loadField(eventId: number): Promise<Field | null> {
  const layout = await getEffectiveLayout(eventId);
  if (!layout) return null;
  const [picks, outcomes] = await Promise.all([
    prisma.pick.findMany({
      where: { eventId },
      select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
    prisma.stageOutcome.findMany({
      where: { eventId },
      select: { sectionId: true, groupId: true, slotIndex: true, winnerPickId: true, resolvedAt: true },
    }),
  ]);
  const outcomeMap: OutcomeMap = {};
  const resolvedCount = new Map<number, number>();
  const resolvedAt = new Map<number, number>();
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    if (o.winnerPickId !== 0) resolvedCount.set(o.sectionId, (resolvedCount.get(o.sectionId) ?? 0) + 1);
    resolvedAt.set(o.sectionId, Math.max(resolvedAt.get(o.sectionId) ?? 0, o.resolvedAt.getTime()));
  }
  const pickMap: PlayerPickMap = {};
  for (const p of picks) {
    pickMap[p.playerId] ??= {};
    pickMap[p.playerId][p.sectionId] ??= {};
    pickMap[p.playerId][p.sectionId][p.groupId] ??= {};
    pickMap[p.playerId][p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }
  const pointsBySection = new Map<string, Map<number, number>>();
  for (const pid of Object.keys(pickMap)) {
    const b = scorePlayer(layout, pickMap[pid], outcomeMap);
    pointsBySection.set(pid, new Map(b.bySection.map((x) => [x.sectionId, x.points] as const)));
  }
  return { layout, stages: stagesOf(layout), pickMap, outcomeMap, resolvedCount, resolvedAt, pointsBySection };
}

function getField(eventId: number, nowMs: number): Promise<Field | null> {
  const hit = fieldMemo.get(eventId);
  if (hit && nowMs - hit.at < FIELD_TTL_MS) return hit.field;
  const field = loadField(eventId).catch(() => null);
  fieldMemo.set(eventId, { at: nowMs, field });
  return field;
}

function sectionSlots(layout: Layout, sectionId: number): number {
  const s = layout.sections.find((x) => x.sectionid === sectionId);
  return s ? s.groups.reduce((n, g) => n + g.picks.length, 0) : 0;
}

function sectionResolved(f: Field, sectionId: number): boolean {
  const slots = sectionSlots(f.layout, sectionId);
  return slots > 0 && (f.resolvedCount.get(sectionId) ?? 0) >= slots;
}

/** Every slot of a playoff section picked AND right (only meaningful once resolved). */
function sectionAllCorrect(f: Field, playerId: string, sectionId: number): boolean {
  const s = f.layout.sections.find((x) => x.sectionid === sectionId);
  if (!s) return false;
  for (const g of s.groups) {
    for (const slot of g.picks) {
      const want = f.outcomeMap[sectionId]?.[g.groupid]?.[slot.index];
      const got = f.pickMap[playerId]?.[sectionId]?.[g.groupid]?.[slot.index];
      if (!want || got !== want) return false;
    }
  }
  return true;
}

/** Swiss: both the 3-0 and the 0-3 bucket called exactly (as sets). */
function perfectSwiss(f: Field, playerId: string, sectionId: number): boolean {
  const s = f.layout.sections.find((x) => x.sectionid === sectionId);
  if (!s) return false;
  let checked = 0;
  for (const g of s.groups) {
    for (const bucket of bucketSwissSlots(g.picks.length)) {
      if (!/3:0|0:3/.test(bucket.label)) continue;
      const resolved = new Set<number>();
      const picked = new Set<number>();
      for (const i of bucket.slotIndexes) {
        const w = f.outcomeMap[sectionId]?.[g.groupid]?.[i];
        if (w) resolved.add(w);
        const p = f.pickMap[playerId]?.[sectionId]?.[g.groupid]?.[i];
        if (p) picked.add(p);
      }
      if (resolved.size !== bucket.slotIndexes.length) return false;
      for (const t of resolved) if (!picked.has(t)) return false;
      checked++;
    }
  }
  return checked > 0;
}

function stageFacts(
  f: Field,
  eventId: number,
  playerId: string,
  rankBySection: Map<number, number>,
  seals: Map<number, { visibility: "public" | "hidden"; lockedAtMs: number }>,
): StageFact[] {
  const cfg = getEventConfig(eventId);
  const players = [...f.pointsBySection.keys()];
  const out: StageFact[] = [];
  let prevLast: number | null = null;
  for (const st of f.stages) {
    const picked = st.sectionIds.reduce((n, sid) => {
      const groups = f.pickMap[playerId]?.[sid] ?? {};
      return n + Object.values(groups).reduce((m, slots) => m + Object.values(slots).filter((v) => v !== 0).length, 0);
    }, 0);
    const resolved = st.sectionIds.every((sid) => sectionResolved(f, sid));
    const resolvedAtMs = resolved ? Math.max(...st.sectionIds.map((sid) => f.resolvedAt.get(sid) ?? 0)) : null;
    const pointsOf = (pid: string) => st.sectionIds.reduce((n, sid) => n + (f.pointsBySection.get(pid)?.get(sid) ?? 0), 0);
    const lockIso = cfg ? lockTimeForSection(st.stageId, cfg.lockSchedule) : null;
    const last = st.sectionIds[st.sectionIds.length - 1];
    const qf = st.isPlayoffs ? st.sectionIds[0] : null;
    const gf = st.isPlayoffs ? last : null;
    out.push({
      stageId: st.stageId,
      isPlayoffs: st.isPlayoffs,
      full: st.slotCount > 0 && picked >= st.slotCount,
      lockAtMs: lockIso ? Date.parse(lockIso) : null,
      resolvedAtMs,
      points: pointsOf(playerId),
      topPoints: resolved ? Math.max(0, ...players.map(pointsOf)) : null,
      rankAfter: rankBySection.get(last) ?? null,
      rankBefore: prevLast !== null ? rankBySection.get(prevLast) ?? null : null,
      perfectSwiss: !st.isPlayoffs && resolved && perfectSwiss(f, playerId, st.stageId),
      allQuarterFinals: qf !== null && sectionResolved(f, qf) ? sectionAllCorrect(f, playerId, qf) : null,
      quarterFinalsAtMs: qf !== null ? f.resolvedAt.get(qf) ?? null : null,
      champion: gf !== null && st.sectionIds.length > 1 && sectionResolved(f, gf) ? sectionAllCorrect(f, playerId, gf) : null,
      championAtMs: gf !== null ? f.resolvedAt.get(gf) ?? null : null,
      seal: seals.get(st.stageId) ?? null,
    });
    prevLast = last;
  }
  return out;
}

export async function gatherPlayerFacts(playerId: string, nowMs: number = Date.now()): Promise<PlayerFacts> {
  const [played, ranks, seals, synced, reactions] = await Promise.all([
    prisma.pick.findMany({ where: { playerId }, distinct: ["eventId"], select: { eventId: true } }),
    prisma.rankSnapshot.findMany({ where: { playerId }, select: { eventId: true, sectionId: true, rank: true } }),
    prisma.pickLock.findMany({
      where: { playerId },
      select: { eventId: true, sectionId: true, initialVisibility: true, lockedAt: true },
    }),
    prisma.pick.findFirst({
      where: { playerId, isLocal: false, pickId: { not: 0 } },
      orderBy: { updatedAt: "asc" },
      select: { updatedAt: true },
    }),
    prisma.reaction.findMany({ where: { senderId: playerId }, select: { createdAt: true } }),
  ]);

  const majors: MajorFact[] = [];
  for (const { eventId } of played) {
    const cfg = getEventConfig(eventId);
    if (!cfg) continue;
    const field = await getField(eventId, nowMs);
    if (!field) continue;
    const rankBySection = new Map(ranks.filter((r) => r.eventId === eventId).map((r) => [r.sectionId, r.rank] as const));
    const sealBy = new Map(
      seals
        .filter((s) => s.eventId === eventId)
        .map((s) => [
          s.sectionId,
          { visibility: s.initialVisibility === "public" ? ("public" as const) : ("hidden" as const), lockedAtMs: s.lockedAt.getTime() },
        ] as const),
    );
    const mint = await coinMintAtMs(eventId, nowMs);
    const tookPart = Object.values(field.pickMap[playerId] ?? {}).some((g) =>
      Object.values(g).some((slots) => Object.values(slots).some((v) => v !== 0)),
    );
    majors.push({
      eventId,
      slug: cfg.slug,
      stages: stageFacts(field, eventId, playerId, rankBySection, sealBy),
      finishedAtMs: mint,
      finished: mint !== null && tookPart,
    });
  }

  return {
    majors,
    syncedAtMs: synced ? synced.updatedAt.getTime() : null,
    reactionsSentAtMs: reactions.map((r) => r.createdAt.getTime()),
    nowMs,
  };
}

export interface PlayerProgression {
  unlocks: Unlock[];
  unlocked: ReadonlySet<AchievementKey>;
  ledger: LedgerRow[];
  xp: number;
  /** Computed for unlocks; NOT shown on Hotline until PHATT ID sign-in is live. */
  level: number;
  felts: (FeltDef & { unlocked: boolean })[];
  /** The saved choice, already checked against what the player holds. */
  loadout: Loadout;
}

export async function getPlayerProgression(
  playerId: string,
  nowMs: number = Date.now(),
  loadoutJson?: string | null,
): Promise<PlayerProgression> {
  const facts = await gatherPlayerFacts(playerId, nowMs);
  const unlocks = evaluateAchievements(facts);
  const ledger = ledgerFor(facts, unlocks);
  const xp = ledgerTotal(ledger);
  const level = levelForXp(xp);
  const unlocked = new Set(unlocks.map((u) => u.key));
  const json =
    loadoutJson !== undefined
      ? loadoutJson
      : (await prisma.player.findUnique({ where: { id: playerId }, select: { loadout: true } }))?.loadout ?? null;
  return {
    unlocks,
    unlocked,
    ledger,
    xp,
    level,
    felts: FELTS.map((f) => ({ ...f, unlocked: f.level <= level })),
    loadout: effectiveLoadout(parseLoadout(json), level, unlocked),
  };
}

/** XP banked before achievements launched: the retroactive credit the welcome hands over. */
export function prelaunchXp(ledger: readonly LedgerRow[]): number {
  return ledger.filter((r) => r.atMs < ACHIEVEMENTS_LAUNCH_MS).reduce((n, r) => n + r.credited, 0);
}

/** What the PHATT ID welcome page (/phatt-id) walks a player through. */
export interface WelcomeHaul {
  entryId: string;
  /** Short names of the Majors the retroactive haul came from, e.g. ["IEM Cologne 2026"]. */
  majors: string[];
  /** Achievements earned before launch, in the order they were earned. */
  unlocks: Unlock[];
  /** XP banked before launch. */
  xp: number;
  /** Case felts open to them now (navy included). */
  feltsUnlocked: number;
}

/**
 * The PHATT ID welcome (PHA-4477): the Cologne accounts' retroactive haul.
 * Announced once in the bell ("Welcome to PHATT ID", entry `ach:launch`) and
 * opened at the player's own pace on /phatt-id, never pushed over the page
 * (Brandon 10/24). Not gated on read state: the page stays reachable.
 */
export async function getWelcomeHaul(playerId: string, nowMs: number = Date.now()): Promise<WelcomeHaul> {
  const p = await getPlayerProgression(playerId, nowMs, null);
  const unlocks = p.unlocks.filter((u) => u.atMs < ACHIEVEMENTS_LAUNCH_MS).sort((a, b) => a.atMs - b.atMs);
  const majors = [...new Set(unlocks.map((u) => u.eventId).filter((e): e is number => e !== null))]
    .map((e) => getEventConfig(e)?.name.replace(/\s+CS2 Major Championship$/i, "") ?? null)
    .filter((n): n is string => !!n);
  return {
    entryId: WELCOME_ENTRY_ID,
    majors,
    unlocks,
    xp: prelaunchXp(p.ledger),
    feltsUnlocked: p.felts.filter((f) => f.unlocked).length,
  };
}
