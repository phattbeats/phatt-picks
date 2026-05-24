/**
 * GET /api/push/public-key — the VAPID public key the client needs to subscribe.
 * Returns { key: null } when push isn't configured, so the UI can hide the opt-in.
 */

import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/notify";

export async function GET() {
  return NextResponse.json({ key: getVapidPublicKey() });
}
