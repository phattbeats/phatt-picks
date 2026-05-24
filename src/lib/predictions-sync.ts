/**
 * Read/mirror pipeline — SERVER-SIDE ONLY (imports authcode.ts → crypto.ts).
 *
 * Pulls a player's live Valve predictions and mirrors them into the local Pick
 * table as non-local rows (isLocal=false), keyed by event_id (rule #9), with
 * itemids carried through as strings (rule #2). The picks screen and (later)
 * the leaderboard read from the Pick table, so a single mirror feeds the whole
 * UI without the rest of the app ever touching the Steam read path (rule #6).
 *
 * Degrades gracefully (rules #7/#8): a missing steamId/auth code or any Valve
 * error leaves stored picks untouched and returns the reason — a failed read
 * never throws into the UI, and the failure is reported rather than retried.
 */

import { prisma } from "@/lib/db";
import { getDecryptedAuthCode } from "@/lib/authcode";
import { fetchTournamentPredictions, ValveApiError } from "@/lib/valve";
import { parsePredictions } from "@/lib/predictions";

export type MirrorSkip = "no-steam-id" | "no-auth-code";

export interface MirrorResult {
  ok: boolean;
  mirrored: number;
  skipped?: MirrorSkip;
  error?: string;
}

/**
 * Read a player's live predictions for `eventId` and mirror them into Pick rows.
 * Returns a structured result; only throws on a programming error, never on a
 * Valve/network failure (those come back as `{ ok: false, error }`).
 */
export async function mirrorPlayerPredictions(
  playerId: string,
  eventId: number,
): Promise<MirrorResult> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { steamId: true },
  });
  if (!player?.steamId) return { ok: false, mirrored: 0, skipped: "no-steam-id" };

  const authCode = await getDecryptedAuthCode(playerId);
  if (!authCode) return { ok: false, mirrored: 0, skipped: "no-auth-code" };

  let mirrored;
  try {
    const envelope = await fetchTournamentPredictions(eventId, player.steamId, authCode);
    const preds = parsePredictions(envelope);

    // Mirror as non-local rows; itemId string straight through (rule #2).
    await prisma.$transaction(
      preds.map((p) =>
        prisma.pick.upsert({
          where: {
            playerId_eventId_sectionId_groupId_slotIndex: {
              playerId,
              eventId,
              sectionId: p.sectionId,
              groupId: p.groupId,
              slotIndex: p.slotIndex,
            },
          },
          update: { pickId: p.pickId, itemId: p.itemId ?? "", isLocal: false },
          create: {
            playerId,
            eventId,
            sectionId: p.sectionId,
            groupId: p.groupId,
            slotIndex: p.slotIndex,
            pickId: p.pickId,
            itemId: p.itemId ?? "",
            isLocal: false,
          },
        }),
      ),
    );
    mirrored = preds.length;
  } catch (e) {
    const error =
      e instanceof ValveApiError ? e.message : e instanceof Error ? e.message : String(e);
    return { ok: false, mirrored: 0, error };
  }

  // A successful read = this player's picks are synced from Valve. The synced
  // flag gates the coin (rule #4) and marks rows as Valve-sourced for scoring.
  await prisma.player.update({ where: { id: playerId }, data: { synced: true } });

  return { ok: true, mirrored };
}

// In-process throttle so a server-rendered screen can refresh live picks on load
// without hammering the Pick'Em API (and without retry-storming a failing one —
// a failed read still occupies the window). Single-container app, so one Map
// across the process is the whole footprint.
const lastSyncAt = new Map<string, number>();
const SYNC_TTL_MS = 60_000;

/**
 * Mirror at most once per `SYNC_TTL_MS` per (player, event). Returns the normal
 * MirrorResult, or `{ ok: true, mirrored: 0, throttled: true }` when skipped.
 */
export async function mirrorPlayerPredictionsThrottled(
  playerId: string,
  eventId: number,
): Promise<MirrorResult & { throttled?: boolean }> {
  const key = `${playerId}:${eventId}`;
  const now = Date.now();
  if (now - (lastSyncAt.get(key) ?? 0) < SYNC_TTL_MS) {
    return { ok: true, mirrored: 0, throttled: true };
  }
  lastSyncAt.set(key, now);
  return mirrorPlayerPredictions(playerId, eventId);
}
