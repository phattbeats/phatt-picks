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
  fetchTournamentPredictions,
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
 * Attempt the upload for an already-resolved batch and reconcile the result
 * back into the Pick table. PHA-853: Valve only accepts single-pick calls
 * (the indexed batch shape returns 400), so we issue N sequential uploads and
 * reconcile each pick independently. A partial failure (some 200, some 4xx)
 * keeps the successes synced and surfaces the first failure's status/body in
 * the WriteResult — picks that didn't 200 stay local for retry. Never throws
 * into the UI (rules #7/#8).
 */
async function uploadAndReconcile(
  playerId: string,
  eventId: number,
  steamId: string,
  authCode: string,
  picks: UploadPick[],
): Promise<WriteResult> {
  let results;
  try {
    results = await uploadTournamentPredictions(eventId, steamId, authCode, picks);
  } catch (e) {
    // The per-pick loop catches Valve HTTP failures; reaching here means
    // something below the loop blew up (most likely network/fetch error before
    // any request even left). Degrade and keep all picks local (rule #7 — §5
    // "re-query later, don't assume failure").
    return {
      ok: false,
      synced: 0,
      degraded: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Reconcile each pick: 200s flip to isLocal:false (and adopt any reassigned
  // itemid); non-200s stay local with the existing itemid.
  let synced = 0;
  let firstFailure: { status: number; error: string } | null = null;
  let shapeError: string | null = null;

  for (const r of results) {
    if (r.ok && r.envelope) {
      let assigned: Map<string, string>;
      try {
        assigned = parseAssignedItemIds(r.envelope);
      } catch (e) {
        // 200 with an unparseable body — log, mark shapeError, but don't yet
        // claim this pick is synced. Will be returned as escalate below.
        shapeError = e instanceof WriteShapeError ? e.message : String(e);
        continue;
      }
      const adopted = assigned.get(
        `${r.pick.sectionId}:${r.pick.groupId}:${r.pick.slotIndex}`,
      );
      await prisma.pick.update({
        where: {
          playerId_eventId_sectionId_groupId_slotIndex: {
            playerId,
            eventId,
            sectionId: r.pick.sectionId,
            groupId: r.pick.groupId,
            slotIndex: r.pick.slotIndex,
          },
        },
        data: { itemId: adopted ?? r.pick.itemId, isLocal: false },
      });
      synced++;
    } else if (!r.ok && firstFailure === null) {
      firstFailure = {
        status: r.status,
        error: r.errorBody ? r.errorBody.slice(0, 200) : `HTTP ${r.status}`,
      };
    }
  }

  // All picks landed → flip the player.synced flag (rule #4 — gates the coin).
  if (synced === picks.length && !firstFailure && !shapeError) {
    await prisma.player.update({ where: { id: playerId }, data: { synced: true } });
    return { ok: true, synced };
  }

  if (shapeError) {
    return { ok: false, synced, escalate: true, error: shapeError };
  }

  if (firstFailure) {
    const disposition = classifyWriteFailure(firstFailure.status);
    return {
      ok: false,
      synced,
      status: firstFailure.status,
      error: firstFailure.error,
      ...(disposition === "degrade" ? { degraded: true } : { escalate: true }),
    };
  }

  // Should be unreachable — guard so we never silently report ok:true for 0 picks.
  return { ok: false, synced: 0, escalate: true, error: "no picks attempted" };
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

  // Read current Steam picks — skip any that are already correctly set so we
  // only send changed picks. This avoids conflicts where re-uploading an
  // already-locked pick interferes with subsequent uploads (PHA-875 root cause).
  let steamBySlot: Map<number, number> = new Map();
  try {
    const pred = await fetchTournamentPredictions(eventId, steamId, authCode);
    const rawPicks = pred?.result?.picks ?? [];
    for (const p of rawPicks) {
      const slotIndex = Number(p.index);
      const pickId = Number(p.pickid);
      const sectionId = Number(p.sectionid);
      // Log ALL raw entries including partial ones (PHA-875 diagnostics).
      console.info(`[write] steam entry: sectionid=${p.sectionid} groupid=${p.groupid} index=${p.index} pickid=${p.pickid} itemid=${p.itemid}`);
      if (Number.isFinite(sectionId) && Number.isFinite(pickId) && Number.isFinite(slotIndex) && pickId !== 0) {
        steamBySlot.set(slotIndex, pickId);
      }
    }
    console.info(`[write] current Steam picks: ${JSON.stringify(Object.fromEntries([...steamBySlot.entries()]))}`);
  } catch (e) {
    console.warn("[write] could not read current Steam state, uploading all picks:", e instanceof Error ? e.message : String(e));
  }

  // Resolve every pick's itemid; an unresolvable one is unexpected → escalate (#8).
  let resolved: UploadPick[];
  try {
    resolved = orderPicks(rows.map((r) => resolveUploadPick(r, itemIdByTeam)));
  } catch (e) {
    return { ok: false, synced: 0, escalate: true, error: e instanceof Error ? e.message : String(e) };
  }

  // Only upload picks that differ from what's currently on Steam.
  // Sending an unchanged pick (same team at same slot) can conflict with partial
  // sticker-lock state left by previous failed uploads (PHA-875).
  const toUpload = resolved.filter(p => steamBySlot.get(p.slotIndex) !== p.pickId);
  const skipped = resolved.length - toUpload.length;
  if (skipped > 0) {
    console.info(`[write] skipping ${skipped} pick(s) already correctly set on Steam`);
  }
  console.info(`[write] uploading ${toUpload.length} pick(s)`);

  // Mark skipped picks as synced in the DB (they already match Steam state).
  const alreadySynced = resolved.filter(p => steamBySlot.get(p.slotIndex) === p.pickId);
  for (const p of alreadySynced) {
    await prisma.pick.update({
      where: {
        playerId_eventId_sectionId_groupId_slotIndex: {
          playerId, eventId, sectionId: p.sectionId, groupId: p.groupId, slotIndex: p.slotIndex,
        },
      },
      data: { isLocal: false },
    });
  }

  if (toUpload.length === 0) {
    // All picks already match Steam — mark player synced and return ok.
    await prisma.player.update({ where: { id: playerId }, data: { synced: true } });
    return { ok: true, synced: skipped };
  }

  const result = await uploadAndReconcile(playerId, eventId, steamId, authCode, toUpload);
  // Count skipped picks as already-synced in the reported total.
  return { ...result, synced: result.synced + skipped };
}
