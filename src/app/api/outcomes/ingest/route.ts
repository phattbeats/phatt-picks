/**
 * Outcome ingestion trigger — POST resolves stage results into StageOutcome.
 *
 * Owner-gated (operational action), consistent with /api/players/local: a bare
 * session is not enough because GET /api/auth/local mints one for anyone, so
 * only the owner may drive resolution. A headless cron (PHA-859) is expected to
 * authenticate as the owner or via a future shared secret decided in that work.
 * Any scheduler/cron that calls this route
 * MUST treat a `reason: "no-locked-unresolved"` response as authoritative and
 * back off until stage state changes — the ingest is event-gated (PHA-844),
 * not on a polling timer. ingestOutcomes makes the same gate authoritative
 * regardless of caller, so a misbehaving scheduler still makes zero source
 * calls pre-event; this route just exposes the gate to caller diagnostics.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { ingestOutcomes } from "@/lib/outcomes";

const EVENT_ID = 26;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const summary = await ingestOutcomes(EVENT_ID);
  return NextResponse.json(summary);
}
