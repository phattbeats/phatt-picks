/**
 * Server-side ONLY access to per-user Valve auth codes.
 *
 * This module imports src/lib/crypto.ts (Node `crypto`), so importing it from a
 * client component is a build error — that is the guardrail keeping decrypted
 * auth codes off the client. Only call these from route handlers / server code.
 */

import { prisma } from "@/lib/db";
import { decryptAuthCode } from "@/lib/crypto";
import { getEventBySlug, getEventConfig } from "@/lib/events-core";
import { eventShortName } from "@/lib/leaderboard";
import { fetchTournamentPredictions, ValveApiError } from "@/lib/valve";

/**
 * Codes saved before we recorded the Major (authCodeEventId null) were all
 * saved for IEM Cologne 2026.
 */
const LEGACY_AUTH_CODE_EVENT_ID = getEventBySlug("iem-cologne-2026")?.eventId ?? 26;

/** The Major a stored code was saved for. */
function codeEventId(authCodeEventId: number | null): number {
  return authCodeEventId ?? LEGACY_AUTH_CODE_EVENT_ID;
}

/**
 * Valve doesn't document whether a Game Authentication Code outlives a Major,
 * so a code saved for another Major is checked once, read-only, before it is
 * used: if Valve accepts it for this Major it carries over, otherwise it stays
 * unused until the player pastes a new one. Failed checks back off (a burst of
 * bad steamidkeys gets the whole site 503'd), keyed `${playerId}:${eventId}`.
 */
const carryRetryAt = new Map<string, number>();
const CARRY_REJECTED_MS = 24 * 60 * 60 * 1000; // 403: Valve refused the code
const CARRY_TRANSIENT_MS = 10 * 60 * 1000; // anything else: try again later

async function carryOver(playerId: string, eventId: number, steamId: string, code: string): Promise<boolean> {
  const key = `${playerId}:${eventId}`;
  if ((carryRetryAt.get(key) ?? 0) > Date.now()) return false;
  try {
    await fetchTournamentPredictions(eventId, steamId, code);
  } catch (e) {
    const rejected = e instanceof ValveApiError && e.status === 403;
    carryRetryAt.set(key, Date.now() + (rejected ? CARRY_REJECTED_MS : CARRY_TRANSIENT_MS));
    return false;
  }
  carryRetryAt.delete(key);
  await prisma.player.update({ where: { id: playerId }, data: { authCodeEventId: eventId } });
  return true;
}

/**
 * Decrypt and return a player's Valve auth code for `eventId`, or null if none
 * is set. A code saved for a different Major is only returned once Valve has
 * accepted it for this one (carryOver); call this only when the event's
 * Pick'Em is open.
 */
export async function getDecryptedAuthCode(playerId: string, eventId: number): Promise<string | null> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { authCode: true, authCodeEventId: true, steamId: true },
  });
  if (!player?.authCode) return null;
  const code = decryptAuthCode(player.authCode);
  if (codeEventId(player.authCodeEventId) === eventId) return code;
  if (!player.steamId) return null;
  return (await carryOver(playerId, eventId, player.steamId, code)) ? code : null;
}

/** Whether a player has a stored auth code, without decrypting it. */
export async function hasAuthCode(playerId: string): Promise<boolean> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { authCode: true },
  });
  return Boolean(player?.authCode);
}

/**
 * Is the stored code for this Major? A code saved for another Major is
 * "stale" until Valve accepts it for this one (carryOver) or the player
 * pastes a new code; until then sync doesn't use it.
 */
export async function authCodeStatus(
  playerId: string,
  eventId: number,
): Promise<{ status: "none" | "current" | "stale"; savedForEventId: number | null }> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { authCode: true, authCodeEventId: true },
  });
  if (!player?.authCode) return { status: "none", savedForEventId: null };
  const savedFor = codeEventId(player.authCodeEventId);
  return { status: savedFor === eventId ? "current" : "stale", savedForEventId: savedFor };
}

/** "IEM Cologne 2026" for the Major a stale code was saved for, or a fallback. */
export function savedForLabel(eventId: number | null): string {
  const e = eventId != null ? getEventConfig(eventId) : null;
  return e ? eventShortName(e) : "an earlier Major";
}
