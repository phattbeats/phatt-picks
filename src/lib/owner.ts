/**
 * Owner check — single-owner admin gate.
 *
 * The owner is whoever's SteamID64 matches OWNER_STEAM_ID. Used to gate the
 * local-player cleanup endpoints + the /profile admin section. A missing or
 * empty env var disables the gate (nobody is owner) — fail closed.
 */

import type { Session } from "./session";

function getOwnerSteamId(): string | null {
  const raw = process.env.OWNER_STEAM_ID;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isOwner(session: Session | null | undefined): boolean {
  if (!session?.steamId) return false;
  const owner = getOwnerSteamId();
  if (!owner) return false;
  return session.steamId === owner;
}
