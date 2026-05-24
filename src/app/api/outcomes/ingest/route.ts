/**
 * Outcome ingestion trigger — POST resolves stage results into StageOutcome.
 *
 * Session-gated (operational action). In production this is driven by a cron/
 * admin path during the event; the hard-cache logic in ingestOutcomes makes it
 * safe to call repeatedly — it only hits a source when slots remain unresolved.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ingestOutcomes } from "@/lib/outcomes";

const EVENT_ID = 26;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const summary = await ingestOutcomes(EVENT_ID);
  return NextResponse.json(summary);
}
