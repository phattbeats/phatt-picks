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
 * Decrypt and return a player's Valve auth code for `eventId`, or null if none
 * is set or the stored code was saved for a different Major. Each Major needs
 * its own code, so an old one is never sent to Valve.
 */
export async function getDecryptedAuthCode(playerId: string, eventId: number): Promise<string | null> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { authCode: true, authCodeEventId: true },
  });
  if (!player?.authCode) return null;
  if (codeEventId(player.authCodeEventId) !== eventId) return null;
  return decryptAuthCode(player.authCode);
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
 * Is the stored code for this Major? Each Major needs its own Game
 * Authentication Code, so a code saved for another Major is "stale": sync
 * stops using it and the player is asked for this Major's code.
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
