/**
 * GET /api/invite — the session player's shareable invite link.
 * Session-gated. Mints a stable code on first call (Steam players), returns it
 * plus the absolute /join URL friends open to onboard.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ensureInviteCode } from "@/lib/invite";
import { buildInviteUrl } from "@/lib/invite-core";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const code = await ensureInviteCode(session.playerId);
  return NextResponse.json({ code, url: buildInviteUrl(BASE_URL, code) });
}
