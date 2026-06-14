/**
 * Live Spotlight odds warm/refresh trigger (PHA-1066).
 *
 * Populates SpotlightOddsCache by fetching the authored playoff matchups from
 * Polymarket's gamma-api SYNCHRONOUSLY (via warmSpotlightOdds), so the Spotlight
 * market bar has data without waiting on the on-read driver's deferred fetch.
 * Hit once after a deploy during a stage to warm; a periodic poke keeps it fresh.
 *
 * Intentionally UNAUTHENTICATED, safe by construction (mirrors
 * /api/standings/refresh and /api/team-stats/refresh):
 *   - takes NO user input — only fetches the hard-coded, committed matchup slugs
 *     in PLAYOFF_MARKET_SLUGS (no SSRF surface),
 *   - only writes our own public-odds cache (no data exposure, nothing
 *     destructive),
 *   - rate-limited: gated/off-window no-ops, and a warm cache is bounded by the
 *     same ~1h SourceState claim the on-read driver uses (a COLD cache always
 *     fetches so a stamped-but-empty slot self-heals).
 * The route matcher excludes /api from the splash gate, so this is reachable
 * without a session — the point (deploy-time warm + headless poke). Gated until
 * Valve seeds the bracket: an empty registry returns { status: "gated" }.
 */

import { NextResponse } from "next/server";
import { warmSpotlightOdds } from "@/lib/spotlight-odds";
import { currentEventId } from "@/lib/events-core";

export const dynamic = "force-dynamic";

async function warm() {
  // PHA-1046 removed the module-load-bound ACTIVE_EVENT_ID; resolve the live
  // event per-request so this stays correct across a Major rollover.
  const eventId = currentEventId();
  const result = await warmSpotlightOdds(eventId);
  return NextResponse.json({ ok: true, eventId, ...result });
}

// GET so it's trivial to warm from a browser / curl / uptime poke; POST aliased.
export const GET = warm;
export const POST = warm;
