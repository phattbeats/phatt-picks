/**
 * Pure planning for the local → Steam pick claim (PHA-1232).
 *
 * The Steam OpenID callback upserts purely by steamId and never looks at an
 * existing local (guest) player, so picks made as a guest are stranded the
 * moment the user signs in with Steam — the documented gap from PHA-1213.
 * This module is the brains of the fix: given a local account's login token,
 * a Steam user can pull that guest's picks onto their Steam account.
 *
 * The merge direction is always local → Steam, never the reverse. A local pick
 * transfers only when the Steam account hasn't already picked that exact slot,
 * so a Steam pick (which may already be pushed to the official Valve Pick'Em)
 * is never clobbered. Conflicting local picks are dropped — they vanish with
 * the retired guest account.
 *
 * Kept free of next/prisma so the verify harness can exercise the slot rules
 * without a database (scripts/verify-local-merge.ts).
 */

export interface PickSlot {
  eventId: number;
  sectionId: number;
  groupId: number;
  slotIndex: number;
}

/** Stable identity of a pick slot — the Pick row's unique tuple sans player. */
export function pickSlotKey(s: PickSlot): string {
  return `${s.eventId}:${s.sectionId}:${s.groupId}:${s.slotIndex}`;
}

/**
 * Extract a login token from a pasted value. The user may paste the full
 * cross-device login link (`…/api/auth/token-login?t=<token>`) or the raw
 * token. Shared by the server claim route and TokenSignInPanel's client-side
 * extraction so both inputs work identically from one definition.
 */
export function extractLoginToken(raw: string): string {
  const s = raw.trim();
  const m = s.match(/[?&]t=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return s;
}

export interface LocalPickRef extends PickSlot {
  id: string;
}

export interface MergePlan {
  /** Local pick ids to re-key onto the Steam account. */
  reassign: string[];
  /** Local pick ids dropped — the Steam account already owns that slot. */
  skipped: string[];
}

/**
 * Decide which local picks transfer to the Steam account.
 *
 * A local pick moves only when its slot is free on the Steam side. The taken
 * set grows as we accept picks so two local picks can never both claim the same
 * slot (defensive — the Pick unique constraint already forbids it per player).
 */
export function planLocalMerge(
  localPicks: LocalPickRef[],
  steamSlotKeys: Iterable<string>,
): MergePlan {
  const taken = new Set(steamSlotKeys);
  const reassign: string[] = [];
  const skipped: string[] = [];
  for (const p of localPicks) {
    const key = pickSlotKey(p);
    if (taken.has(key)) {
      skipped.push(p.id);
    } else {
      reassign.push(p.id);
      taken.add(key);
    }
  }
  return { reassign, skipped };
}
