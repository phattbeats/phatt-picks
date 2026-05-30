/**
 * Wire ingestion trigger — POST upserts the curated seed (PHA-857).
 *
 * Session-gated (operational action), same shape as /api/outcomes/ingest. Today
 * it only materializes the committed seed into NewsItem, so it makes zero
 * external calls and is safe to call repeatedly. It is the single seam an
 * automated pull (RSS / HLTV) would plug into: resolve stories to WireItems and
 * upsert them inside ingestNews.
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
