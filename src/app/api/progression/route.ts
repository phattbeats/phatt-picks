/**
 * GET /api/progression — the signed-in player's own PHATT ID progression on
 * Hotline (PHA-4477): achievements, the XP ledger, and the PHATT ID items they
 * hold (struck coins + trinkets, keyed as the arcade inventory will key them).
 *
 * Self only. This is the record Phase 3 replays into the arcade service once
 * PHATT ID sign-in links Hotline accounts; the UI doesn't show the level yet.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPlayerProgression } from "@/lib/progression";
import { getPlayerChallengeCoins } from "@/lib/challenge-coins";
import { coinItemKey, trinketItemKey } from "@/lib/progression-core";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const nowMs = Date.now();
  const [p, coins] = await Promise.all([
    getPlayerProgression(session.playerId, nowMs),
    getPlayerChallengeCoins(session.playerId, nowMs),
  ]);

  return NextResponse.json({
    xp: p.xp,
    level: p.level,
    achievements: p.unlocks.map((u) => ({ key: u.key, eventId: u.eventId, at: new Date(u.atMs).toISOString() })),
    items: [
      ...coins.map((c) => ({ key: coinItemKey(c.slug, c.tier), at: new Date(c.earnedAtMs).toISOString() })),
      ...p.unlocks.map((u) => ({ key: trinketItemKey(u.key), at: new Date(u.atMs).toISOString() })),
    ],
    loadout: p.loadout,
    ledger: p.ledger.map((r) => ({
      day: r.day,
      source: r.source,
      raw: r.raw,
      credited: r.credited,
      cappedBy: r.cappedBy,
      at: new Date(r.atMs).toISOString(),
    })),
  });
}
