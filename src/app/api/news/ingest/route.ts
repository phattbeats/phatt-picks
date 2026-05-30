/**
 * Wire ingestion trigger — POST upserts the curated seed (PHA-857).
 *
 * Owner-gated (operational action), same shape as /api/outcomes/ingest. A bare
 * session is insufficient because GET /api/auth/local mints one for anyone; only
 * the owner may drive ingestion. As HLTV/RSS auto-ingest (PHA-859) goes live,
 * its headless caller authenticates as owner or via a shared secret decided
 * there — this guard keeps the route from being a third-party abuse vector. Today
 * it only materializes the committed seed into NewsItem, so it makes zero
 * external calls and is safe to call repeatedly. It is the single seam an
 * automated pull (RSS / HLTV) would plug into: resolve stories to WireItems and
 * upsert them inside ingestNews.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { ingestNews } from "@/lib/news";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const summary = await ingestNews();
  return NextResponse.json(summary);
}
