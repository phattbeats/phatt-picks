/**
 * POST /api/push/test — send a sample pre-lock reminder to the session player's
 * own devices. Backs the DoD: "an opted-in user receives a test pre-lock push."
 * Session-gated; always 200 with a structured outcome (sent/failed/pruned),
 * except a 429 when the per-player cooldown is hit.
 *
 * PHA-1045 (from the PHA-1015 audit): this had no rate limit, so a signed-in
 * user could hammer it as a self-targeted push amplifier. A short per-player
 * cooldown caps the send rate; the store is module-level (single standalone
 * Node server = one shared view).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isPushConfigured, sendTestPreLockPush } from "@/lib/notify";
import { createCooldownStore, checkCooldown } from "@/lib/security-core";
import { isSameOrigin } from "@/lib/csrf";

const PUSH_TEST_COOLDOWN_MS = 30_000;
const cooldown = createCooldownStore();

export async function POST(req: NextRequest) {
  // CSRF: this is a simple POST (no JSON preflight to shield it), so a cross-site
  // form could fire a victim's own test push. Require our own origin.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isPushConfigured()) {
    return NextResponse.json({ ok: false, reason: "push-not-configured", sent: 0 });
  }

  const gate = checkCooldown(cooldown, session.playerId, PUSH_TEST_COOLDOWN_MS, Date.now());
  if (!gate.allowed) {
    return NextResponse.json(
      { ok: false, reason: "rate-limited", retryAfterMs: gate.retryAfterMs, sent: 0 },
      { status: 429, headers: { "Retry-After": String(Math.ceil(gate.retryAfterMs / 1000)) } },
    );
  }

  const outcome = await sendTestPreLockPush(session.playerId);
  return NextResponse.json({ ok: true, ...outcome });
}
