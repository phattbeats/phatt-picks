/**
 * invite.ts — SERVER invite-code persistence. Pure string logic is in
 * invite-core; this layer mints codes (node crypto) and resolves them via prisma.
 *
 * Every player gets a stable invite code lazily (the local-auth route already
 * mints one on creation; Steam players get theirs on first /api/invite hit).
 */

import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { isValidInviteCode, normalizeInviteCode } from "@/lib/invite-core";

function mint(): string {
  return randomBytes(6).toString("hex");
}

/** Return the player's invite code, generating + persisting one if absent. */
export async function ensureInviteCode(playerId: string): Promise<string> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { inviteCode: true },
  });
  if (player?.inviteCode && isValidInviteCode(player.inviteCode)) return player.inviteCode;

  // Generate; retry once on the (vanishingly rare) unique collision.
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = mint();
    try {
      await prisma.player.update({ where: { id: playerId }, data: { inviteCode: code } });
      return code;
    } catch {
      // unique constraint — try a fresh code
    }
  }
  throw new Error("Could not allocate an invite code");
}

export interface InviteInfo {
  displayName: string;
  avatarUrl: string | null;
  isLocal: boolean;
}

/** Resolve an invite code to its owner (the inviter), or null if unknown. */
export async function resolveInvite(code: string): Promise<InviteInfo | null> {
  if (!isValidInviteCode(code)) return null;
  const player = await prisma.player.findUnique({
    where: { inviteCode: normalizeInviteCode(code) },
    select: { displayName: true, avatarUrl: true, isLocal: true },
  });
  return player ?? null;
}
