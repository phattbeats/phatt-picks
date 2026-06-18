/**
 * POST /api/auth/local/claim — bring a guest (local) account's picks onto the
 * signed-in Steam account (PHA-1232).
 *
 * The Steam callback never merges a pre-existing local player, so picks made as
 * a guest are stranded once the user signs in with Steam (PHA-1213 gap). This
 * route closes it via the existing cross-device login token: a Steam user
 * pastes their guest login link/token and we move that guest's picks over, then
 * retire the guest account so it no longer doubles up on the leaderboard.
 *
 * Direction is strictly local → Steam. A local pick transfers only into a slot
 * the Steam account hasn't already picked (we never clobber a pick that may be
 * pushed to Valve); conflicting picks are dropped with the retired account.
 *
 * Body: { token: string } — raw token or the full token-login URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isSameOrigin } from "@/lib/csrf";
import {
  extractLoginToken,
  planLocalMerge,
  pickSlotKey,
} from "@/lib/local-merge-core";

export async function POST(req: NextRequest) {
  // CSRF defense-in-depth alongside the JSON-body CORS preflight.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Only a Steam account can absorb a guest — the merge has nowhere durable to
  // land on a local session, and a local user already keeps their picks.
  if (!session.steamId) {
    return NextResponse.json(
      { error: "Sign in with Steam to bring guest picks over." },
      { status: 403 },
    );
  }

  let rawToken: unknown;
  try {
    ({ token: rawToken } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof rawToken !== "string" || !rawToken.trim()) {
    return NextResponse.json(
      { error: "Paste your guest login link or token." },
      { status: 400 },
    );
  }

  const token = extractLoginToken(rawToken);

  const local = await prisma.player.findUnique({
    where: { loginToken: token },
    select: { id: true, displayName: true, isLocal: true, steamId: true },
  });
  // Must be a real local guest account — not a Steam player, not unknown.
  if (!local || !local.isLocal || local.steamId !== null) {
    return NextResponse.json(
      { error: "That link isn't a guest account we can bring over." },
      { status: 404 },
    );
  }
  if (local.id === session.playerId) {
    return NextResponse.json(
      { error: "That's already this account." },
      { status: 400 },
    );
  }

  const [localPicks, steamPicks] = await Promise.all([
    prisma.pick.findMany({
      where: { playerId: local.id },
      select: { id: true, eventId: true, sectionId: true, groupId: true, slotIndex: true },
    }),
    prisma.pick.findMany({
      where: { playerId: session.playerId },
      select: { eventId: true, sectionId: true, groupId: true, slotIndex: true },
    }),
  ]);

  const plan = planLocalMerge(localPicks, steamPicks.map(pickSlotKey));

  await prisma.$transaction(async (tx) => {
    if (plan.reassign.length > 0) {
      // Moved picks were never pushed to Valve under this Steam account, so they
      // stay isLocal=true — the user Locks In to push them.
      await tx.pick.updateMany({
        where: { id: { in: plan.reassign } },
        data: { playerId: session.playerId, isLocal: true },
      });
      // The Steam account now holds unsynced picks again; reflect that so the
      // sync pill is honest. predictions-sync flips it back on the next push.
      await tx.player.update({
        where: { id: session.playerId },
        data: { synced: false },
      });
    }
    // Retire the guest account. Pick/PushSubscription/RankSnapshot cascade on
    // Player delete, so any conflicted picks left behind clear too and the guest
    // drops off the leaderboard.
    await tx.player.delete({ where: { id: local.id } });
  });

  return NextResponse.json({
    merged: plan.reassign.length,
    skipped: plan.skipped.length,
    from: local.displayName,
  });
}
