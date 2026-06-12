/**
 * Server-side ONLY access to per-user Valve auth codes.
 *
 * This module imports src/lib/crypto.ts (Node `crypto`), so importing it from a
 * client component is a build error — that is the guardrail keeping decrypted
 * auth codes off the client. Only call these from route handlers / server code.
 */

import { prisma } from "@/lib/db";
import { decryptAuthCode } from "@/lib/crypto";

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
