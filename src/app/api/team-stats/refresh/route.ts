/**
 * Live team-dossier warm/refresh trigger (PHA-921).
 *
 * Populates the TeamStatsCache by batch-crawling the field's HLTV profiles
 * SYNCHRONOUSLY (via warmTeamStats), so the dossier's "Last 5 matches" is
 * guaranteed to have data without depending on the on-read driver's deferred
 * `after()` crawl — which leaves a freshly-deployed (empty-cache) container
 * serving the frozen snapshot until a crawl happens to land. Hit this once after
 * a deploy during a stage to warm the cache; a periodic poke keeps it fresh.
 *
 * Intentionally UNAUTHENTICATED, safe by construction (mirrors
 * /api/standings/refresh):
 *   - takes NO user input — only crawls the hard-coded HLTV team profiles for the
 *     committed field (TEAM_SOURCES); no SSRF surface,
 *   - only writes our own public-dossier cache (no data exposure, nothing
 *     destructive),
 *   - rate-limited: off-window no-ops, and a warm cache is bounded by the same
 *     ~1h SourceState claim the on-read driver uses (a COLD cache always crawls so
 *     a stamped-but-empty slot self-heals).
 * The route matcher excludes /api from the splash gate, so this is reachable
 * without a session — the point (deploy-time warm + headless poke).
 */

import { NextResponse } from "next/server";
import { warmTeamStats } from "@/lib/team-stats";

const EVENT_ID = 26;

export const dynamic = "force-dynamic";

async function warm() {
  const result = await warmTeamStats(EVENT_ID);
  return NextResponse.json({ ok: true, eventId: EVENT_ID, ...result });
}

// GET so it's trivial to warm from a browser / curl / uptime poke; POST aliased.
export const GET = warm;
export const POST = warm;
