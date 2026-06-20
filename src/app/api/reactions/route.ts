/**
 * POST /api/reactions — drop a Bleachers stamp on another player's pick
 * (PHA-1211, concept A). One stamp per sender per pick: the upsert on the
 * (sender, pick) unique key makes a repeat drop a SWAP, not an additive spam
 * vector. The sender is recorded but stays masked in the UI until the stage
 * resolves (see bleachers-core bleachersUnmasked).
 *
 * Guards, in order: same-origin (CSRF — this is a JSON POST but we keep parity
 * with /api/push/test), authenticated, valid stamp, not your own pick, the pick
 * exists, the stage is REVEALED (you can only react to picks you can see — same
 * lock gate as the profile page), and a short per-sender cooldown. On success it
 * pings the target's devices ("someone's in your bleachers") and returns the
 * fresh public tally for that pick so the client can reconcile optimistically.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/csrf";
import { createCooldownStore, checkCooldown } from "@/lib/security-core";
import { isValidStampId, getStamp, tallyReactions } from "@/lib/bleachers-core";
import { isLockTimePassed } from "@/lib/lock-schedule-core";
import { isSwissSection } from "@/lib/swiss-bucket-core";
import { currentEventId } from "@/lib/events-core";
import { getCommittedLayout } from "@/lib/layout";
import { isPushConfigured, sendPushToPlayer } from "@/lib/notify";
import { buildReactionPayload } from "@/lib/notify-core";
import { parseNotifPrefs } from "@/lib/notifications-core";

const DROP_COOLDOWN_MS = 3_000;
const cooldown = createCooldownStore();

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: "bad-origin" }, { status: 403 });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-json" }, { status: 400 });
  }
  const { targetPlayerId, sectionId, groupId, slotIndex, stampId } = (body ?? {}) as Record<string, unknown>;

  if (
    typeof targetPlayerId !== "string" ||
    typeof stampId !== "string" ||
    !Number.isInteger(sectionId) ||
    !Number.isInteger(groupId) ||
    !Number.isInteger(slotIndex)
  ) {
    return NextResponse.json({ ok: false, reason: "bad-input" }, { status: 400 });
  }
  if (!isValidStampId(stampId)) {
    return NextResponse.json({ ok: false, reason: "bad-stamp" }, { status: 400 });
  }
  if (targetPlayerId === session.playerId) {
    return NextResponse.json({ ok: false, reason: "self" }, { status: 400 });
  }

  const eventId = currentEventId();
  const sId = sectionId as number;
  const gId = groupId as number;
  const slot = slotIndex as number;

  // You can only react to a pick you can actually see. The profile page reveals a
  // stage's picks once its lock passes (or it resolves); mirror that gate so the
  // Bleachers can never be used to probe a hidden pick. Self-reaction is already
  // blocked above, so this is purely the public-reveal gate.
  if (!isLockTimePassed(sId, Date.now())) {
    return NextResponse.json({ ok: false, reason: "not-revealed" }, { status: 409 });
  }

  // Read-only-on-resolve is a SWISS rule. The playoff bracket resolves
  // match-by-match while it's still the live event everyone reacts to
  // (PHA-1262), so the resolved gate must not fire on QF/SF/GF picks — only on
  // a fully-resolved Swiss group.
  const layout = getCommittedLayout();
  const section = layout.sections.find((s) => s.sectionid === sId);
  const group = section?.groups.find((g) => g.groupid === gId);
  if (group && isSwissSection(sId)) {
    const outcomeCount = await prisma.stageOutcome.count({
      where: { eventId, sectionId: sId, groupId: gId },
    });
    if (outcomeCount >= group.picks.length) {
      return NextResponse.json({ ok: false, reason: "resolved" }, { status: 409 });
    }
  }

  const pick = await prisma.pick.findUnique({
    where: {
      playerId_eventId_sectionId_groupId_slotIndex: {
        playerId: targetPlayerId,
        eventId,
        sectionId: sId,
        groupId: gId,
        slotIndex: slot,
      },
    },
    select: { id: true },
  });
  if (!pick) {
    return NextResponse.json({ ok: false, reason: "no-pick" }, { status: 404 });
  }

  const gate = checkCooldown(cooldown, session.playerId, DROP_COOLDOWN_MS, Date.now());
  if (!gate.allowed) {
    return NextResponse.json(
      { ok: false, reason: "rate-limited", retryAfterMs: gate.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(gate.retryAfterMs / 1000)) } },
    );
  }

  // One drop per sender per pick — swap the stamp on a repeat instead of stacking.
  await prisma.reaction.upsert({
    where: {
      senderId_eventId_sectionId_groupId_slotIndex: {
        senderId: session.playerId,
        eventId,
        sectionId: sId,
        groupId: gId,
        slotIndex: slot,
      },
    },
    create: {
      eventId,
      sectionId: sId,
      groupId: gId,
      slotIndex: slot,
      targetPlayerId,
      senderId: session.playerId,
      stampId,
    },
    update: { stampId },
  });

  // Re-read the pick's rows for the fresh public tally (masked — no senderId out).
  const rows = await prisma.reaction.findMany({
    where: { eventId, sectionId: sId, groupId: gId, slotIndex: slot, targetPlayerId },
    select: { stampId: true, senderId: true },
  });
  const tally = tallyReactions(rows, session.playerId).map((t) => ({
    id: t.stamp.id,
    glyph: t.stamp.glyph,
    label: t.stamp.label,
    kind: t.stamp.kind,
    count: t.count,
    mine: t.mine,
  }));

  // Ping the target — only when push is configured AND the target has opted in.
  // Anonymous by design ("someone"), the name lands at resolve.
  if (isPushConfigured()) {
    const targetPlayer = await prisma.player.findUnique({
      where: { id: targetPlayerId },
      select: { notifPrefs: true },
    });
    const prefs = parseNotifPrefs(targetPlayer?.notifPrefs);
    if (prefs.reactions.push) {
      const stamp = getStamp(stampId)!;
      void sendPushToPlayer(
        targetPlayerId,
        buildReactionPayload({ stampGlyph: stamp.glyph, stampLabel: stamp.label, targetPlayerId }),
      ).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, tally });
}
