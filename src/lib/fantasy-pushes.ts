/**
 * fantasy-pushes — Web Push for HOTLINE Fantasy (PHA-5454). Four moments:
 *
 *   open     a stage's pool is set, so its draft is open     -> everyone opted in
 *   remind   24 h and 1 h before the stage starts scoring    -> opted in, no five yet
 *   points   new match results moved a manager's score       -> that manager
 *   final    the stage is played out                         -> managers who entered it
 *
 * open / remind / final are clock- and state-driven and run on the scheduler
 * tick (instrumentation.ts). points is event-driven: ingestFantasyTick calls
 * it with the matches it just stored, so a backfill or a re-read never pings.
 *
 * DEDUP IS PERSISTENT. Each one-shot push claims a SourceState row
 * (`fantasy-push:<kind>:…`) before the fan-out, so a redeploy in the middle of
 * a Major does not send it again. A failed claim means "do not send". The
 * claim row's timestamp is also when the in-app feed dates the entry.
 *
 * Only players with a push subscription and `fantasy.push` enabled are sent
 * to. Wording lives in notify-core. Never throws.
 */

import { prisma } from "@/lib/db";
import { sendPushToPlayer } from "@/lib/notify";
import {
  DEFAULT_FIRE_WINDOW_MS,
  FANTASY_REMINDER_OFFSETS_MS,
  buildFantasyFinalPayload,
  buildFantasyOpenPayload,
  buildFantasyPointsPayload,
  buildFantasyReminderPayload,
  dueReminders,
  prelockSchedulerEnabled,
  type FantasyGain,
  type PreLockPayload,
} from "@/lib/notify-core";
import { parseNotifPrefs } from "@/lib/notifications-core";
import { buildFantasyBoard, hasFantasy, type FantasyBoard } from "@/lib/fantasy";
import { lineupGain } from "@/lib/fantasy-core";

/** A stage that went final longer ago than this is not announced (bounds a first deploy mid-Major). */
const FINAL_RECENCY_MS = 2 * 24 * 60 * 60_000;

export function fantasyPushKey(kind: "open" | "final", eventId: number, stageId: number): string;
export function fantasyPushKey(kind: "remind", eventId: number, stageId: number, fireAtMs: number): string;
export function fantasyPushKey(kind: string, eventId: number, stageId: number, fireAtMs?: number): string {
  return `fantasy-push:${kind}:${eventId}:${stageId}${fireAtMs != null ? `:${fireAtMs}` : ""}`;
}

/** Claim a one-shot key. True only for the first caller ever; false on any error. */
async function claimOnce(key: string): Promise<boolean> {
  const now = new Date();
  try {
    const inserted = await prisma.$executeRaw`
      INSERT OR IGNORE INTO "SourceState" ("id", "source", "lastCallAt", "updatedAt")
      VALUES (lower(hex(randomblob(16))), ${key}, ${now}, ${now})
    `;
    return inserted > 0;
  } catch {
    return false;
  }
}

/** When each one-shot fantasy push of an event was claimed: key -> ms. */
export async function fantasyPushClaims(eventId: number): Promise<Map<string, number>> {
  const rows = await prisma.sourceState
    .findMany({ where: { source: { startsWith: "fantasy-push:" } }, select: { source: true, lastCallAt: true } })
    .catch(() => []);
  return new Map(
    rows.filter((r) => r.source.split(":")[2] === String(eventId)).map((r) => [r.source, r.lastCallAt.getTime()]),
  );
}

function enabled(): boolean {
  return prelockSchedulerEnabled(process.env.PRELOCK_REMINDERS_ENABLED, process.env.PRELOCK_REMINDERS_DISABLED);
}

/** Players with a push subscription and fantasy pushes switched on. */
async function optedIn(only?: readonly string[]): Promise<string[]> {
  const subbed = await prisma.pushSubscription.findMany({
    where: only ? { playerId: { in: [...only] } } : undefined,
    select: { playerId: true },
    distinct: ["playerId"],
  });
  if (subbed.length === 0) return [];
  const players = await prisma.player.findMany({
    where: { id: { in: subbed.map((s) => s.playerId) } },
    select: { id: true, notifPrefs: true },
  });
  return players.filter((p) => parseNotifPrefs(p.notifPrefs).fantasy.push).map((p) => p.id);
}

async function fanOut(recipients: readonly string[], payloadFor: (playerId: string) => PreLockPayload | null): Promise<number> {
  let sent = 0;
  for (const playerId of recipients) {
    const payload = payloadFor(playerId);
    if (!payload) continue;
    sent += (await sendPushToPlayer(playerId, payload)).sent;
  }
  return sent;
}

function managersOf(board: FantasyBoard, stageId: number): string[] {
  return (board.byStage.get(stageId) ?? []).map((r) => r.managerId);
}

/** open + remind + final for the current Major. Runs on the scheduler tick. */
export async function runFantasyPushes(eventId: number, nowMs: number = Date.now()): Promise<void> {
  if (!enabled() || !hasFantasy(eventId)) return;
  const board = await buildFantasyBoard(eventId, null, nowMs);
  if (!board || board.ctx.frozen) return;

  for (const view of board.ctx.stages) {
    const { stage } = view;

    if (view.phase === "open") {
      if (await claimOnce(fantasyPushKey("open", eventId, stage.id))) {
        const payload = buildFantasyOpenPayload({ stageName: stage.short, stageId: stage.id, startMs: view.startMs, nowMs });
        const sent = await fanOut(await optedIn(), () => payload);
        console.log(`[fantasy-push] ${stage.short} draft open: ${sent} push(es)`);
      }
      if (view.startMs != null) {
        for (const r of dueReminders(nowMs, view.startMs, FANTASY_REMINDER_OFFSETS_MS, DEFAULT_FIRE_WINDOW_MS)) {
          if (!(await claimOnce(fantasyPushKey("remind", eventId, stage.id, r.fireAtMs)))) continue;
          const has = new Set(managersOf(board, stage.id));
          const payload = buildFantasyReminderPayload({ stageName: stage.short, stageId: stage.id, startMs: view.startMs, nowMs });
          const sent = await fanOut((await optedIn()).filter((id) => !has.has(id)), () => payload);
          console.log(`[fantasy-push] ${stage.short} ${r.label} reminder: ${sent} push(es)`);
        }
      }
    }

    if (view.phase === "final" && view.matches.length > 0) {
      // The read time of the stage's last match stands in for "went final".
      const at = view.lastFetchedMs;
      if (at == null || nowMs - at > FINAL_RECENCY_MS) continue;
      if (!(await claimOnce(fantasyPushKey("final", eventId, stage.id)))) continue;
      const standings = board.byStage.get(stage.id) ?? [];
      const rowOf = new Map(standings.map((r) => [r.managerId, r]));
      const sent = await fanOut(await optedIn(managersOf(board, stage.id)), (id) => {
        const row = rowOf.get(id);
        return row
          ? buildFantasyFinalPayload({ stageName: stage.short, stageId: stage.id, total: row.total, rank: row.rank, managers: standings.length })
          : null;
      });
      console.log(`[fantasy-push] ${stage.short} final: ${sent} push(es)`);
    }
  }
}

export interface FantasyPointsDelta {
  managerId: string;
  stageId: number;
  gained: number;
  gains: FantasyGain[];
}

/** What the given matches added to every lineup; managers who gained nothing are left out. */
export function fantasyPointsDeltas(board: FantasyBoard, newMatchIds: readonly number[]): FantasyPointsDelta[] {
  const fresh = new Set(newMatchIds);
  const out: FantasyPointsDelta[] = [];
  for (const view of board.ctx.stages) {
    if (!view.matches.some((m) => fresh.has(m.hltvMatchId))) continue;
    const nickOf = new Map(view.matches.flatMap((m) => m.players.map((p) => [p.id, p.nick] as const)));
    for (const { stored } of board.scored.values()) {
      if (stored.stageId !== view.stage.id) continue;
      const g = lineupGain(
        stored.lineup,
        stored.lockedAtMs,
        { stage: view.stage, stageStartMs: view.startMs, matches: view.matches, pool: view.pool },
        fresh,
      );
      if (g.gained <= 0) continue;
      out.push({
        managerId: stored.managerId,
        stageId: view.stage.id,
        gained: g.gained,
        gains: g.players.map((p) => ({ nick: nickOf.get(p.playerId) ?? `#${p.playerId}`, points: p.points })),
      });
    }
  }
  return out;
}

/** points: called by the ingest tick with the matches it just stored. */
export async function runFantasyPointsPushes(eventId: number, newMatchIds: readonly number[], nowMs: number = Date.now()): Promise<void> {
  if (!enabled() || newMatchIds.length === 0 || !hasFantasy(eventId)) return;
  const board = await buildFantasyBoard(eventId, null, nowMs);
  if (!board) return;
  const deltas = fantasyPointsDeltas(board, newMatchIds);
  if (deltas.length === 0) return;
  const allowed = new Set(await optedIn(deltas.map((d) => d.managerId)));
  let sent = 0;
  for (const d of deltas) {
    if (!allowed.has(d.managerId)) continue;
    const standings = board.byStage.get(d.stageId) ?? [];
    const row = standings.find((r) => r.managerId === d.managerId);
    const stage = board.ctx.stages.find((v) => v.stage.id === d.stageId)?.stage;
    if (!row || !stage) continue;
    const payload = buildFantasyPointsPayload({
      stageName: stage.short,
      stageId: d.stageId,
      gained: d.gained,
      gains: d.gains,
      total: row.total,
      rank: row.rank,
      managers: standings.length,
    });
    sent += (await sendPushToPlayer(d.managerId, payload)).sent;
  }
  console.log(`[fantasy-push] points for ${newMatchIds.length} match(es): ${deltas.length} manager(s) moved, ${sent} push(es)`);
}

/* ── in-app feed facts ────────────────────────────────────────────────── */

export interface FantasyFeedStage {
  stageId: number;
  stageName: string;
  phase: "waiting" | "open" | "live" | "final";
  startMs: number | null;
  /** When the draft-open push was claimed, else null. */
  openedAtMs: number | null;
  /** When the stage went final (claim time, else the last match read). */
  finalAtMs: number | null;
  /** manager id -> standing in this stage. */
  standing: Map<string, { rank: number; total: number }>;
  managers: number;
}

const FEED_TTL_MS = 60_000;
let feedMemo: { eventId: number; atMs: number; stages: FantasyFeedStage[] } | null = null;

/**
 * What the notification feed needs to know about the fantasy game, shared by
 * every player and memoised for a minute (the bell and the stream poll often).
 */
export async function fantasyFeedStages(eventId: number, nowMs: number = Date.now()): Promise<FantasyFeedStage[]> {
  if (!hasFantasy(eventId)) return [];
  if (feedMemo && feedMemo.eventId === eventId && nowMs - feedMemo.atMs < FEED_TTL_MS) return feedMemo.stages;
  const [board, claims] = await Promise.all([buildFantasyBoard(eventId, null, nowMs), fantasyPushClaims(eventId)]);
  if (!board || board.ctx.frozen) return [];
  const stages = board.ctx.stages.map((v): FantasyFeedStage => {
    const standings = board.byStage.get(v.stage.id) ?? [];
    return {
      stageId: v.stage.id,
      stageName: v.stage.short,
      phase: v.phase,
      startMs: v.startMs,
      openedAtMs: claims.get(fantasyPushKey("open", eventId, v.stage.id)) ?? null,
      finalAtMs: v.phase === "final" ? (claims.get(fantasyPushKey("final", eventId, v.stage.id)) ?? v.lastFetchedMs) : null,
      standing: new Map(standings.map((r) => [r.managerId, { rank: r.rank, total: r.total }])),
      managers: standings.length,
    };
  });
  feedMemo = { eventId, atMs: nowMs, stages };
  return stages;
}
