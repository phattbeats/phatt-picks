/**
 * PATCH /api/loadout — save the player's cosmetic choices (PHA-4477): the case
 * felt, the profile banner photo and the three showcase achievements in the
 * profile hero and the (up to three) charms on the keyring (PHA-4505). Stored as JSON in Player.loadout.
 *
 * Unlocks are derived, never trusted from the client: a felt above the player's
 * level, or a banner or showcase pick from an achievement they don't hold, is
 * refused (403). `null` for felt/banner puts the default back (navy felt / the
 * rotating backdrop); an empty showcase puts back the default pick.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/csrf";
import { getPlayerProgression } from "@/lib/progression";
import { ACHIEVEMENT_BY_KEY, FELTS, KEYRING_SIZE, SHOWCASE_SIZE, charmsHeld, cleanCharms, cleanShowcase, type AchievementKey, type FeltKey, type Loadout } from "@/lib/progression-core";

export async function PATCH(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: "bad-origin" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { felt?: unknown; banner?: unknown; showcase?: unknown; charms?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const row = await prisma.player.findUnique({ where: { id: session.playerId }, select: { loadout: true } });
  const progression = await getPlayerProgression(session.playerId, Date.now(), row?.loadout ?? null);
  const next: Loadout = { ...progression.loadout };

  if (body.felt !== undefined) {
    if (body.felt === null) next.felt = null;
    else {
      const felt = FELTS.find((f) => f.key === body.felt);
      if (!felt) return NextResponse.json({ error: "Unknown felt" }, { status: 400 });
      if (felt.level > progression.level) return NextResponse.json({ error: "Felt not unlocked yet" }, { status: 403 });
      next.felt = felt.key === "navy" ? null : (felt.key as FeltKey);
    }
  }
  if (body.banner !== undefined) {
    if (body.banner === null) next.banner = null;
    else {
      const key = body.banner as AchievementKey;
      if (!ACHIEVEMENT_BY_KEY.has(key)) return NextResponse.json({ error: "Unknown banner" }, { status: 400 });
      if (!progression.unlocked.has(key)) return NextResponse.json({ error: "Banner not unlocked yet" }, { status: 403 });
      next.banner = key;
    }
  }

  if (body.showcase !== undefined) {
    if (!Array.isArray(body.showcase) || body.showcase.length > SHOWCASE_SIZE) {
      return NextResponse.json({ error: `Pick up to ${SHOWCASE_SIZE}` }, { status: 400 });
    }
    const keys = cleanShowcase(body.showcase);
    if (keys.length !== body.showcase.length) return NextResponse.json({ error: "Unknown achievement" }, { status: 400 });
    if (keys.some((k) => !progression.unlocked.has(k))) {
      return NextResponse.json({ error: "Achievement not unlocked yet" }, { status: 403 });
    }
    next.showcase = keys;
  }

  if (body.charms !== undefined) {
    if (!Array.isArray(body.charms) || body.charms.length > KEYRING_SIZE) {
      return NextResponse.json({ error: `The keyring holds ${KEYRING_SIZE}` }, { status: 400 });
    }
    const keys = cleanCharms(body.charms);
    if (keys.length !== body.charms.length) return NextResponse.json({ error: "Unknown charm" }, { status: 400 });
    const held = charmsHeld(progression.unlocked);
    if (keys.some((k) => !held.includes(k))) return NextResponse.json({ error: "Charm not unlocked yet" }, { status: 403 });
    next.charms = keys;
  }

  await prisma.player.update({ where: { id: session.playerId }, data: { loadout: JSON.stringify(next) } });
  return NextResponse.json({ ok: true, loadout: next });
}
