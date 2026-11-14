/**
 * PHA-4506: Hotline -> arcade (PHATT ID progression), I/O side.
 *
 * Gathers one linked player's derived progression, turns it into signed
 * events (arcade-sync-core) and POSTs them to the arcade's `/api/events` as
 * the `hotline` surface. Runs after a PHATT ID sign-in and on an hourly sweep
 * over every linked player (instrumentation.ts). Idempotent end to end, so
 * running it twice, or after a crash, is always safe.
 *
 * Off unless ARCADE_URL, ARCADE_SURFACE_KID and ARCADE_SURFACE_SECRET are set:
 * the secret is the arcade's `SURFACE_SECRETS.hotline[<kid>]`, handed over
 * out-of-band and never committed.
 */

import { prisma } from "./db";
import { gatherPlayerFacts } from "./progression";
import { getPlayerChallengeCoins } from "./challenge-coins";
import { evaluateAchievements, ledgerFor, CHARMS } from "./progression-core";
import { hookSign } from "./phatt-id-core";
import { buildArcadeEvents, charmEarnedAt, ndjsonBatches, summarize, GAME, type ArcadeReply } from "./arcade-sync-core";

export interface ArcadeSyncConfig {
  url: string;
  kid: string;
  secret: string;
}

export function arcadeSyncConfig(): ArcadeSyncConfig | null {
  const e = process.env;
  if (!e.ARCADE_URL || !e.ARCADE_SURFACE_KID || !e.ARCADE_SURFACE_SECRET) return null;
  return { url: e.ARCADE_URL.replace(/\/+$/, ""), kid: e.ARCADE_SURFACE_KID, secret: e.ARCADE_SURFACE_SECRET };
}

export type SyncReport = ReturnType<typeof summarize> & { sent: number };

/** Replay one player's whole Hotline progression. Null when sync is off or the player has no PHATT ID. */
export async function syncPlayerToArcade(playerId: string, nowMs: number = Date.now()): Promise<SyncReport | null> {
  const cfg = arcadeSyncConfig();
  if (!cfg) return null;
  const player = await prisma.player.findUnique({ where: { id: playerId }, select: { phattIdSub: true } });
  if (!player?.phattIdSub) return null;

  const [facts, coins] = await Promise.all([gatherPlayerFacts(playerId, nowMs), getPlayerChallengeCoins(playerId, nowMs)]);
  const unlocks = evaluateAchievements(facts);
  const finishBy = new Map(coins.map((c) => [c.eventId, c.finish] as const));
  const events = buildArcadeEvents({
    playerId,
    arcadeId: player.phattIdSub,
    nowMs,
    ledger: ledgerFor(facts, unlocks),
    majors: facts.majors
      .filter((m) => m.finished && m.finishedAtMs !== null)
      .map((m) => ({
        eventId: m.eventId,
        score: m.stages.reduce((n, s) => n + s.points, 0),
        rank: finishBy.get(m.eventId) ?? null,
        atMs: m.finishedAtMs!,
      })),
    unlocks,
    coins: coins.map((c) => ({ eventId: c.eventId, slug: c.slug, tier: c.tier, atMs: c.earnedAtMs })),
    charms: charmEarnedAt(CHARMS, unlocks),
  });

  const replies: ArcadeReply[] = [];
  for (const body of ndjsonBatches(events)) {
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`${cfg.url}/api/events`, {
      method: "POST",
      headers: {
        "content-type": "application/x-ndjson",
        "x-arcade-surface": GAME,
        "x-arcade-kid": cfg.kid,
        "x-arcade-ts": ts,
        "x-arcade-sig": hookSign(cfg.secret, ts, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`arcade /api/events ${res.status}`);
    replies.push((await res.json()) as ArcadeReply);
  }
  return { ...summarize(replies), sent: events.length };
}

/** Every linked player, one after another (the arcade rate-limits per member, not per surface). */
export async function syncAllToArcade(nowMs: number = Date.now()): Promise<{ players: number; failed: number; report: SyncReport }> {
  const total: SyncReport = { accepted: 0, duplicate: 0, pending: 0, rejected: [], sent: 0 };
  if (!arcadeSyncConfig()) return { players: 0, failed: 0, report: total };
  const linked = await prisma.player.findMany({ where: { phattIdSub: { not: null } }, select: { id: true } });
  let failed = 0;
  for (const { id } of linked) {
    try {
      const r = await syncPlayerToArcade(id, nowMs);
      if (!r) continue;
      total.accepted += r.accepted;
      total.duplicate += r.duplicate;
      total.pending += r.pending;
      total.sent += r.sent;
      total.rejected.push(...r.rejected);
    } catch (err) {
      failed++;
      console.error(`[arcade-sync] player ${id} failed:`, (err as Error).message);
    }
  }
  return { players: linked.length, failed, report: total };
}
