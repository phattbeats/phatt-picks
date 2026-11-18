/**
 * GET /api/autopilot — the Major autopilot's read-only status (PHA-1406).
 *
 * Every section of the current event with its phase (dark / scheduled /
 * revealed / live / decided), the committed lock + window + source, Valve's
 * live seeding and lock flag, the resolved-slot count, and the findings that
 * need a human. Open: it carries only committed schedule data and public
 * results, no player data. Point an uptime keyword check at `"needs-human"`
 * to page on a config gap without any agent in the loop. See docs/AUTOPILOT.md.
 */
import { NextResponse } from "next/server";
import { autopilotStatus } from "@/lib/autopilot";
import { currentEventId } from "@/lib/events-core";

export const dynamic = "force-dynamic";

export async function GET() {
  const nowMs = Date.now();
  const status = await autopilotStatus(currentEventId(nowMs), nowMs).catch((err) => {
    console.error("[autopilot] status failed:", err);
    return null;
  });
  if (!status) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
