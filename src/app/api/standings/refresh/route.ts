/**
 * Live Swiss standings warm/refresh trigger (PHA-902).
 *
 * Populates the SwissStandingsCache for the live sections by crawling HLTV
 * SYNCHRONOUSLY (via warmStandings), so the bracket + table are guaranteed to
 * have data without depending on the on-read driver's deferred `after()` crawl —
 * which leaves a freshly-deployed (empty-cache) container showing nothing until a
 * crawl happens to land. Hitting this once after a deploy warms the cache; a
 * simple periodic poke keeps it fresh during a stage even if no one is browsing.
 *
 * Intentionally UNAUTHENTICATED, because it is safe by construction:
 *   - it takes NO user input — it only crawls the hard-coded HLTV event pages
 *     for the committed live sections (no SSRF surface),
 *   - it only writes our own public-standings cache (no data exposure, nothing
 *     destructive),
 *   - it is rate-limited: off-window sections no-op, and a warm cache is bounded
 *     by the same ~1h SourceState claim the on-read driver uses, so repeated
 *     calls can't hammer the source (a COLD cache always crawls so a stamped-but-
 *     empty slot self-heals).
 * The route matcher excludes /api from the splash gate, so this is reachable
 * without a session — which is the point (deploy-time warm + headless poke).
 */

import { NextResponse } from "next/server";
import { warmStandings, standingsSectionIds } from "@/lib/swiss-results";

const EVENT_ID = 26;

export const dynamic = "force-dynamic";

async function warmAll() {
  const results = [];
  for (const section of standingsSectionIds()) {
    results.push(await warmStandings(EVENT_ID, section));
  }
  return NextResponse.json({ ok: true, eventId: EVENT_ID, results });
}

// GET so it's trivial to warm from a browser / curl / uptime poke; POST aliased
// for callers that prefer it. Both run the same safe, gated warm.
export const GET = warmAll;
export const POST = warmAll;
