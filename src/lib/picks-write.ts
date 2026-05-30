/**
 * Write path — SERVER-SIDE ONLY (imports authcode.ts → crypto.ts, and prisma).
 *
 * Pushes a player's locally-stored picks up to Valve, stage-batched (handoff §8):
 * one indexed UploadTournamentPredictions call per Swiss stage, and one ordered
 * call for the whole playoff bracket (QF → SF → GF). The local Pick rows are the
 * source of truth — they were stored the moment the user set them — so the
 * leaderboard and comparison always compute off stored picks regardless of
 * whether the upload succeeds (rule #7). A misbehaving write never breaks the UI.
 *
 * Degrade contract (rule #7): WRITE_ENABLED off, a local player (no steamId/auth
 * code), or a documented Valve failure (403/404/410/412/429/503/504/timeout) all
 * leave the local picks untouched and return a structured reason — the stage stays
 * "saved locally," to be mirrored back via the read path once it's set in-client.
 *
 * Escalate contract (rule #8): an UNEXPECTED outcome — an unknown status, or a
 * 200 whose body we can't parse — is surfaced as `escalate:true` rather than
 * retried, so an operator can mark the work blocked with the real error.
 */

import { prisma } from "@/lib/db";
import { getDecryptedAuthCode } from "@/lib/authcode";
import {
  fetchTournamentItems,
  uploadTournamentPredictions,
  ValveApiError,
} from "@/lib/valve";
import { buildItemIdMap } from "@/lib/items";
import {
  resolveUploadPick,
  parseAssignedItemIds,
  classifyWriteFailure,
  orderPicks,
  PLAYOFF_SECTION_IDS,
  WriteShapeError,
  type LocalPick,
  type UploadPick,
} from "@/lib/write-core";

/** The write path is only attempted when the owner has confirmed it viable. */
export function isWriteEnabled(): boolean {
  return process.env.WRITE_ENABLED === "true";
}

export type WriteSkip =
  | "write-disabled"
  | "no-steam-id"
  | "no-auth-code"
  | "no-picks";

export interface WriteResult {
  ok: boolean;
  synced: number; // picks marked synced to Valve
  skipped?: WriteSkip; // graceful no-op; local picks kept
  degraded?: boolean; // attempted, documented failure → kept local (rule #7)
  escalate?: boolean; // unexpected failure → surface & block (rule #8)
  status?: number; // Valve HTTP status when a call failed
  error?: string;
}

/** Preconditions shared by stage + playoff writes. Returns auth, or a skip. */
async function loadWriteAuth(
  playerId: string,
): Promise<{ steamId: string; authCode: string } | { skip: WriteSkip }> {
  if (!isWriteEnabled()) return { skip: "write-disabled" };

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { steamId: true },
  });
  // Local players have no steamId and never write to Valve (rule #6).
  if (!player?.steamId) return { skip: "no-steam-id" };

  const authCode = await getDecryptedAuthCode(playerId);
  if (!authCode) return { skip: "no-auth-code" };

  return { steamId: player.steamId, authCode };
}

/**
 * Attempt the upload for an already-resolved batch and reconcile the result back
 * into the Pick table. Never throws on a Valve/network failure — returns the
 * structured WriteResult instead (degrade vs escalate per rules #7/#8).
 */
async function uploadAndReconcile(
  playerId: string,
  eventId: number,
  steamId: string,
  authCode: string,
  picks: UploadPick[],
): Promise<WriteResult> {
  try {
    const envelope = await uploadTournamentPredictions(eventId, steamId, authCode, picks);

    // 200, but the body must be the shape we expect, or we escalate (rule #8).
    const assigned = parseAssignedItemIds(envelope);

    await prisma.$transaction(
      picks.map((p) => {
        const adopted = assigned.get(`${p.sectionId}:${p.groupId}:${p.slotIndex}`);
        return prisma.pick.update({
          where: {
            playerId_eventId_sectionId_groupId_slotIndex: {
              playerId,
              eventId,
              sectionId: p.sectionId,
              groupId: p.groupId,
              slotIndex: p.slotIndex,
            },
          },
          // Adopt any itemid Valve assigned; mark the row Valve-confirmed.
          data: { itemId: adopted ?? p.itemId, isLocal: false },
        });
      }),
    );

    // A successful write means this player's picks are synced (gates the coin, rule #4).
    await prisma.player.update({ where: { id: playerId }, data: { synced: true } });

    return { ok: true, synced: picks.length };
  } catch (e) {
    if (e instanceof ValveApiError) {
      const disposition = classifyWriteFailure(e.status);
      // Documented failure → keep local picks, fall back to read/mirror (rule #7).
      // Unexpected status → surface & block (rule #8). Either way: no retry here.
      // PHA-853: include the truncated Valve response body so a live 400 surfaces
      // its actual reason to the UI (the docker logs carry the full body).
      const bodySnippet = e.responseBody?.slice(0, 200);
      return {
        ok: false,
        synced: 0,
        status: e.status,
        error: bodySnippet ? `${e.message} — ${bodySnippet}` : e.message,
        ...(disposition === "degrade" ? { degraded: true } : { escalate: true }),
      };
    }
    if (e instanceof WriteShapeError) {
      // 200 with an unparseable body — unexpected shape, escalate (rule #8).
      return { ok: false, synced: 0, escalate: true, error: e.message };
    }
    // Network / timeout (no status): the op may have completed — degrade and
    // let the read/mirror reconcile it later (§5: "re-query later, don't assume failure").
    return {
      ok: false,
      synced: 0,
      degraded: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Sync one Swiss stage's picks to Valve in a single indexed batch. The whole
 * stage (all 10 slots a user has set) goes in one call (§0.1).
 */
export async function syncStageToValve(
  playerId: string,
  eventId: number,
  sectionId: number,
): Promise<WriteResult> {
  const auth = await loadWriteAuth(playerId);
  if ("skip" in auth) return { ok: false, synced: 0, skipped: auth.skip };

  const rows = await prisma.pick.findMany({
    where: { playerId, eventId, sectionId, pickId: { not: 0 } },
  });
  if (rows.length === 0) return { ok: false, synced: 0, skipped: "no-picks" };

  return resolveAndUpload(playerId, eventId, auth.steamId, auth.authCode, rows);
}

/**
 * Sync the entire playoff bracket in one ordered call: Quarterfinals (108), then
 * Semifinals (109), then Grand Final (110) — the bracket is its own single
 * ordered submission (§0.1), distinct from the per-stage Swiss batches.
 */
export async function syncPlayoffBracketToValve(
  playerId: string,
  eventId: number,
): Promise<WriteResult> {
  const auth = await loadWriteAuth(playerId);
  if ("skip" in auth) return { ok: false, synced: 0, skipped: auth.skip };

  const rows = await prisma.pick.findMany({
    where: {
      playerId,
      eventId,
      sectionId: { in: [...PLAYOFF_SECTION_IDS] },
      pickId: { not: 0 },
    },
  });
  if (rows.length === 0) return { ok: false, synced: 0, skipped: "no-picks" };

  return resolveAndUpload(playerId, eventId, auth.steamId, auth.authCode, rows);
}

/**
 * Shared tail: fetch the live items map, resolve each stored pick's itemid from
 * it (rule #2), then upload + reconcile. A failure fetching items, or an
 * unresolvable itemid, is handled per rules #7/#8 — never throws into the UI.
 */
async function resolveAndUpload(
  playerId: string,
  eventId: number,
  steamId: string,
  authCode: string,
  rows: LocalPick[],
): Promise<WriteResult> {
  // Fetch the user's lockable items first (don't invent the itemid — §5).
  let itemIdByTeam: Map<number, string>;
  try {
    const items = await fetchTournamentItems(eventId, steamId, authCode);
    itemIdByTeam = buildItemIdMap(items);
    // Reflect pass ownership from Valve's own answer: a non-empty type:"team"
    // items map = the player owns this event's viewer pass (rule #4, spec §6).
    // hasValveCoin / coinTier stay untouched — their cutoffs are unverified.
    await prisma.player.update({
      where: { id: playerId },
      data: { hasViewerPass: itemIdByTeam.size > 0 },
    });
  } catch (e) {
    if (e instanceof ValveApiError) {
      const disposition = classifyWriteFailure(e.status);
      return {
        ok: false,
        synced: 0,
        status: e.status,
        error: `GetTournamentItems: ${e.message}`,
        ...(disposition === "degrade" ? { degraded: true } : { escalate: true }),
      };
    }
    return {
      ok: false,
      synced: 0,
      degraded: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Resolve every pick's itemid; an unresolvable one is unexpected → escalate (#8).
  let upload: UploadPick[];
  try {
    upload = orderPicks(rows.map((r) => resolveUploadPick(r, itemIdByTeam)));
  } catch (e) {
    return { ok: false, synced: 0, escalate: true, error: e instanceof Error ? e.message : String(e) };
  }

  return uploadAndReconcile(playerId, eventId, steamId, authCode, upload);
}
