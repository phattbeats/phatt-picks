/**
 * Wire ingestion trigger — POST upserts the curated seed + automated HLTV pull
 * (PHA-857 seam, PHA-859 source).
 *
 * Owner-gated manual trigger (consistent with /api/players/local), same shape as
 * /api/outcomes/ingest. There is NO headless caller of this route: PHA-859 made
 * automated HLTV ingestion self-refreshing on read (getNews fires a fire-and-
 * forget background pull once the source floor elapses), so freshness needs no
 * cron and no caller posts here. This route stays only for an explicit owner-
 * driven re-ingest, so it can be owner-gated freely. It materializes the
 * committed seed and then attempts the HLTV RSS pull, both through the same
 * idempotent upsert. The automated pull carries a persisted 5-minute refresh
 * floor (SourceState, source="hltv") that is authoritative regardless of caller,
 * so a misbehaving caller still can't hammer the feed.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { ingestNews } from "@/lib/news";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isOwner(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const summary = await ingestNews();
  return NextResponse.json(summary);
}
