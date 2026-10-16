/**
 * Seal picks — a player's opt-in commitment on one stage (pick-lock-core).
 *
 *   POST   { sectionId, visibility: "public" | "hidden" } → seal the stage
 *   PATCH  { sectionId, visibility: "public" }            → hidden → public
 *   DELETE                                                → always 409 (final)
 *
 * `sectionId` may be any section in the unit (a playoff round seals the whole
 * bracket). Sealing requires the stage to still be open (same gate as POST
 * /api/picks) and every slot in the unit to hold a call. Once sealed, POST
 * /api/picks refuses edits to the unit with 409 `picks_sealed`, and the Steam
 * mirror stops overwriting it.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isSameOrigin } from "@/lib/csrf";
import { currentEventId } from "@/lib/events-core";
import {
  canChangeVisibility,
  canSeal,
  canUnseal,
  initialSteamMatched,
  parseVisibility,
  sealUnitFor,
} from "@/lib/pick-lock-core";
import { getSeal, toSealView, unitWriteGate } from "@/lib/pick-lock";

async function readBody(req: NextRequest): Promise<{ sectionId: number; visibility: unknown } | null> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const sectionId = Number(body?.sectionId);
    if (!Number.isInteger(sectionId) || sectionId <= 0) return null;
    return { sectionId, visibility: body?.visibility };
  } catch {
    return null;
  }
}

async function guard(req: NextRequest) {
  if (!isSameOrigin(req)) return { error: NextResponse.json({ error: "bad_origin" }, { status: 403 }) };
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  return { session };
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const eventId = currentEventId();
  const unit = sealUnitFor(body.sectionId);
  const playerId = g.session.playerId;

  const [existing, gate] = await Promise.all([getSeal(playerId, eventId, unit), unitWriteGate(eventId, unit)]);
  const rows = gate.sectionIds.length
    ? await prisma.pick.findMany({
        where: { playerId, eventId, sectionId: { in: gate.sectionIds } },
        select: { pickId: true, isLocal: true },
      })
    : [];
  const filled = rows.filter((r) => r.pickId !== 0).length;

  const decision = canSeal({
    stageWritable: gate.writable,
    filled,
    total: gate.total,
    existing,
    visibility: body.visibility,
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.reason, filled, total: gate.total }, { status: decision.status });
  }

  const visibility = parseVisibility(body.visibility)!;
  const now = new Date();
  try {
    const row = await prisma.pickLock.create({
      data: {
        playerId,
        eventId,
        sectionId: unit,
        visibility,
        initialVisibility: visibility,
        lockedAt: now,
        publicAt: visibility === "public" ? now : null,
        // Already on Steam at seal time → a later in-game change is detectable.
        steamMatchedAt: initialSteamMatched(rows) ? now : null,
      },
    });
    return NextResponse.json({ ok: true, seal: toSealView(row) });
  } catch {
    // Unique-key race: a concurrent seal landed first.
    return NextResponse.json({ error: "already_sealed" }, { status: 409 });
  }
}

export async function PATCH(req: NextRequest) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const eventId = currentEventId();
  const existing = await getSeal(g.session.playerId, eventId, body.sectionId);
  const decision = canChangeVisibility(existing, body.visibility);
  if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: decision.status });
  if (decision.noop || !existing) return NextResponse.json({ ok: true, seal: toSealView(existing) });

  const row = await prisma.pickLock.update({
    where: { id: existing.id },
    data: { visibility: "public", publicAt: new Date() },
  });
  return NextResponse.json({ ok: true, seal: toSealView(row) });
}

export async function DELETE() {
  const d = canUnseal();
  return NextResponse.json({ error: d.ok ? null : d.reason }, { status: d.ok ? 200 : d.status });
}
