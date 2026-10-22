/**
 * Server-side ONLY access to per-user Valve auth codes.
 *
 * This module imports src/lib/crypto.ts (Node `crypto`), so importing it from a
 * client component is a build error — that is the guardrail keeping decrypted
 * auth codes off the client. Only call these from route handlers / server code.
 */

import { prisma } from "@/lib/db";
import { decryptAuthCode } from "@/lib/crypto";
import { getEventConfig } from "@/lib/events-core";
import { eventShortName } from "@/lib/leaderboard";

/** Decrypt and return a player's stored Valve auth code, or null if none is set. */
export async function getDecryptedAuthCode(playerId: string): Promise<string | null> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { authCode: true },
  });
  if (!player?.authCode) return null;
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
 * Is the stored code for this Major? Steam may issue a new Game Authentication
 * Code each Major, so a code saved for an earlier one (or before we recorded
 * the Major, `authCodeEventId` null) is "stale": the player is asked for this
 * Major's code. Sync still tries a stale code, in case Steam kept it valid.
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
  const savedFor = player.authCodeEventId ?? null;
  return { status: savedFor === eventId ? "current" : "stale", savedForEventId: savedFor };
}

/** "IEM Cologne 2026" for the Major a stale code was saved for, or a fallback. */
export function savedForLabel(eventId: number | null): string {
  const e = eventId != null ? getEventConfig(eventId) : null;
  return e ? eventShortName(e) : "an earlier Major";
}
