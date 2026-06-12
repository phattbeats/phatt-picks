/**
 * POST /api/avatar — set the signed-in player's profile picture.
 *
 * The client resizes + crops to a small square and sends a JPEG/PNG/WebP data
 * URL, which we store directly in `Player.avatarUrl` (no object storage needed;
 * every avatar render already uses <Image unoptimized>, which passes data URLs
 * straight through). We still validate the MIME prefix and cap the size as a
 * belt-and-suspenders guard against oversized or non-image payloads.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

// ~64 KB of data-URL string. A 160px JPEG at q0.82 is ~10 KB, so this is a
// generous ceiling that still rejects anything that skipped the client resize.
const MAX_LEN = 64 * 1024;
const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let dataUrl: unknown;
  try {
    ({ dataUrl } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof dataUrl !== "string" || !DATA_URL_RE.test(dataUrl)) {
    return NextResponse.json({ error: "Expected a JPEG/PNG/WebP image data URL" }, { status: 400 });
  }
  if (dataUrl.length > MAX_LEN) {
    return NextResponse.json({ error: "Image too large — resize first" }, { status: 413 });
  }

  try {
    await prisma.player.update({
      where: { id: session.playerId },
      data: { avatarUrl: dataUrl },
    });
  } catch (err) {
    console.error("Avatar update error:", err);
    return NextResponse.json({ error: "Could not save avatar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, avatarUrl: dataUrl });
}
