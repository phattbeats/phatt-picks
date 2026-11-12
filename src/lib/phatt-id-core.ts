/**
 * PHA-4101: PHATT ID (Authentik OIDC) sign-in for Hotline — pure policy core.
 *
 * No I/O here so scripts/verify-phatt-id.ts can prove it offline.
 *
 * Link rule (design PHA-4087, epic PHA-4086 decision 10):
 *   1. A Player already linked to this PHATT ID `sub` -> that Player. Linked once, permanently.
 *   2. Else, the token carries a `steam` claim (SteamID64 from the member's linked Steam source)
 *      and an existing Hotline Steam player has that SteamID and no PHATT ID yet -> link it.
 *      Nothing re-created, no picks lost.
 *   3. Else -> a new Player for this PHATT ID.
 *   A Steam player already linked to a DIFFERENT PHATT ID is never taken over (conflict).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const STEAM_ID64_RE = /^\d{17}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isPhattIdSub = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** The `steam` claim, only when it is a well-formed SteamID64 string. */
export function steamClaim(claims: Record<string, unknown>): string | null {
  const s = claims.steam;
  return typeof s === "string" && STEAM_ID64_RE.test(s) ? s : null;
}

export interface PlayerRef {
  id: string;
  phattIdSub: string | null;
}

export type LinkDecision =
  | { kind: "existing"; playerId: string }
  | { kind: "link-steam"; playerId: string }
  | { kind: "create"; steamId: string | null }
  | { kind: "conflict"; reason: "steam_linked_elsewhere" };

export function decideLink(
  sub: string,
  steamId: string | null,
  bySub: PlayerRef | null,
  bySteam: PlayerRef | null,
): LinkDecision {
  if (bySub) return { kind: "existing", playerId: bySub.id };
  if (bySteam) {
    if (bySteam.phattIdSub && bySteam.phattIdSub !== sub) return { kind: "conflict", reason: "steam_linked_elsewhere" };
    return { kind: "link-steam", playerId: bySteam.id };
  }
  return { kind: "create", steamId };
}

/** Display name: the member's PHATT ID username (the hub's default `display` style). */
export function phattIdDisplayName(claims: Record<string, unknown>, sub: string): string {
  const u = claims.preferred_username ?? claims.nickname;
  return typeof u === "string" && u.trim() ? u.trim().slice(0, 40) : `PHATT:${sub.slice(0, 4)}`;
}

/** Same HMAC as the arcade service (phattbeats/arcade src/auth.js): base64url(HMAC-SHA256(secret, ts + "." + data)). */
export const hookSign = (secret: string, ts: string, data: string) =>
  createHmac("sha256", secret).update(`${ts}.${data}`).digest("base64url");

/**
 * Verify an arcade hook call. `secrets` is {kid: secret}. Fails closed on anything missing,
 * a timestamp outside 5 minutes, or a bad signature.
 */
export function verifyHookSig(
  secrets: Record<string, string>,
  kid: string | null,
  ts: string | null,
  sig: string | null,
  data: string,
  nowMs: number,
): boolean {
  const secret = kid ? secrets[kid] : undefined;
  if (!secret || !ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(nowMs - Number(ts) * 1000) > 5 * 60_000) return false;
  const want = Buffer.from(hookSign(secret, ts, data));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function parseHookSecrets(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}
