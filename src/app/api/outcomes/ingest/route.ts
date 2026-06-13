/**
 * Outcome ingestion trigger — POST resolves stage results into StageOutcome.
 *
 * Owner-gated manual trigger (consistent with /api/players/local). There is no
 * automated caller: outcome resolution is event-gated (PHA-844) and driven
 * manually by the owner, so owner-gating this route affects no scheduler.
 * ingestOutcomes makes the event gate authoritative regardless of caller, so a
 * misbehaving caller still makes zero source calls pre-event; this route just
 * exposes the gate to caller diagnostics.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { ingestOutcomes } from "@/lib/outcomes";
import { currentEventId } from "@/lib/events-core";

export async function POST() {
  const EVENT_ID = currentEventId(); // per-request active event (PHA-1046)
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isOwner(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const summary = await ingestOutcomes(EVENT_ID);
  return NextResponse.json(summary);
}
