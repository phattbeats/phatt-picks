/**
 * Wire ingestion trigger — POST upserts the curated seed + automated HLTV pull
 * (PHA-857 seam, PHA-859 source).
 *
 * Session-gated (operational action), same shape as /api/outcomes/ingest. It
 * materializes the committed seed and then attempts the HLTV RSS pull, both
 * through the same idempotent upsert. The automated pull carries a persisted
 * 5-minute refresh floor (SourceState, source="hltv") that is authoritative
 * regardless of caller, so a misbehaving scheduler still can't hammer the feed.
 *
 * Any scheduler/cron that calls this route should read `automated.status` and
 * back off: `throttled` (floor not elapsed) and `empty` (no usable items) are
 * authoritative no-ops. A sane cadence is ~15 min during the event — above the
 * floor, so most ticks actually fetch.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ingestNews } from "@/lib/news";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const summary = await ingestNews();
  return NextResponse.json(summary);
}
