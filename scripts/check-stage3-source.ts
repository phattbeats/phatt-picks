/**
 * check-stage3-source — has HLTV published the IEM Cologne Major 2026 Stage 3
 * event yet, and if so, what's the drop-in config?
 *
 * PHA-926 (surfaced by the PHA-922 health-pass live-config audit): the lock
 * schedule already locks Stage III (section 107) at 2026-06-11T10:30:00Z, but
 * the active event's `sectionSources` (`COLOGNE_2026` in src/lib/events-core.ts,
 * exported as `SECTION_SOURCES`) and `COLOGNE_MATCH_WINDOWS`
 * (src/lib/lock-schedule-core.ts) stop at 106. Until those gain a `107` entry,
 * Stage III locks the picker correctly but the HLTV→StageOutcome bridge has no
 * source, so Stage III never scores and its live standings/bracket panel is
 * empty. The single missing fact is the HLTV event id — external, published by
 * HLTV on their own schedule. Stage 1 = event 9028, Stage 2 = event 9029, but
 * Stage 3 is NOT simply 9030 (that id belongs to a different event) — it must be
 * read off HLTV, not guessed.
 *
 * This is the watcher for that fact. It crawls the major's event hub (event
 * 8301) via the in-network crawl4ai service, looks for a Stage 3 sub-event link
 * (`/events/<id>/iem-cologne-major-2026-stage-3`), and — when one appears —
 * crawls that event page to read its authoritative date span. It then prints the
 * exact `COLOGNE_2026.sectionSources[107]` and `COLOGNE_MATCH_WINDOWS[107]` lines
 * to paste.
 *
 *   Exit 0  → Stage 3 IS published; ready-to-apply config printed on stdout.
 *   Exit 3  → not yet published (the expected state until HLTV posts it).
 *   Exit 1  → crawl/parse error (transient — try again).
 *
 * Designed to be run on a schedule (a Paperclip routine) in the days before the
 * Jun 11 lock: the moment exit 0 lands, apply the two edits, run
 * `verify-lock-schedule` + `verify-swiss-results`, ship, and warm via
 * GET /api/standings/refresh. See docs/PRE-MAJOR-CHECKLIST.md §1.
 *
 * Run (inside the phatt network, where crawl4ai is reachable):
 *   node --experimental-strip-types --no-warnings scripts/check-stage3-source.ts
 *
 * NOT part of the app build or CI — crawl4ai is only reachable from the deploy
 * network, so this is a manual/ops + routine tool, same as gather-team-stats.
 */

const CRAWL_URL = process.env.CRAWL4AI_URL ?? "http://crawl4ai:11235";

/** The IEM Cologne Major 2026 parent event hub on HLTV. */
const HUB_URL = "https://www.hltv.org/events/8301/iem-cologne-major-2026";
/** The section id Stage III maps to in our committed Valve layout. */
const STAGE3_SECTION = 107;

async function crawl(url: string): Promise<string> {
  const res = await fetch(`${CRAWL_URL}/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls: [url], crawler_config: { cache_mode: "BYPASS" } }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`crawl4ai HTTP ${res.status} for ${url}`);
  const json = (await res.json()) as { results?: { html?: string }[] };
  const html = json.results?.[0]?.html;
  if (!html) throw new Error(`crawl4ai returned no html for ${url}`);
  return html;
}

/**
 * Find the Stage 3 sub-event id + slug from the hub HTML. We only trust a real
 * /events/<id>/<slug> link whose slug names stage 3 — the hub also carries news
 * headlines that say "Stage 3" in prose, which must NOT be treated as the event
 * going live. Returns null until a genuine sub-event link exists.
 */
function findStage3(hubHtml: string): { id: string; slug: string } | null {
  const re = /\/events\/(\d+)\/(iem-cologne-major-2026-stage-3[a-z0-9-]*)/gi;
  const m = re.exec(hubHtml);
  if (!m) return null;
  return { id: m[1], slug: m[2] };
}

/** A loose UTC date pull from the event page's schedule block, best-effort. */
function readEventDates(eventHtml: string): { start?: string; end?: string } {
  // HLTV stamps each match/day with a unix-ms data-unix attribute; the span of
  // those is the stage's play window. Best-effort: callers should sanity-check.
  const stamps = [...eventHtml.matchAll(/data-unix="(\d{13})"/g)].map((x) =>
    Number(x[1]),
  );
  if (stamps.length === 0) return {};
  const min = Math.min(...stamps);
  const max = Math.max(...stamps);
  const dayStart = (ms: number) =>
    new Date(ms).toISOString().slice(0, 10) + "T00:00:00Z";
  const dayEnd = (ms: number) =>
    new Date(ms).toISOString().slice(0, 10) + "T23:59:59Z";
  return { start: dayStart(min), end: dayEnd(max) };
}

async function main() {
  const hub = await crawl(HUB_URL);
  const found = findStage3(hub);

  if (!found) {
    console.log(
      `[check-stage3-source] Stage 3 NOT yet published on HLTV hub 8301 ` +
        `(no /events/<id>/iem-cologne-major-2026-stage-3 link).`,
    );
    console.log(`[check-stage3-source] Re-check before the Jun 11 lock.`);
    process.exit(3);
  }

  const eventUrl = `https://www.hltv.org/events/${found.id}/${found.slug}`;
  let dates: { start?: string; end?: string } = {};
  try {
    dates = readEventDates(await crawl(eventUrl));
  } catch (err) {
    console.log(
      `[check-stage3-source] found event but could not read dates: ` +
        `${(err as Error).message} — fill the window by hand.`,
    );
  }

  console.log(`\n✅ Stage 3 IS published: event ${found.id} (${found.slug})\n`);
  console.log(`Apply these two edits (PHA-926), then verify + warm:\n`);
  console.log(`  src/lib/events-core.ts  →  COLOGNE_2026.sectionSources:`);
  console.log(`  ${STAGE3_SECTION}: {`);
  console.log(`    url: "${eventUrl}",`);
  console.log(`    label: "HLTV",`);
  console.log(`  },\n`);
  console.log(`  src/lib/lock-schedule-core.ts  →  COLOGNE_MATCH_WINDOWS:`);
  if (dates.start && dates.end) {
    console.log(
      `  ${STAGE3_SECTION}: { start: "${dates.start}", end: "${dates.end}" }, // Stage III (verify span vs HLTV)`,
    );
  } else {
    console.log(
      `  ${STAGE3_SECTION}: { start: "2026-06-11T00:00:00Z", end: "<last play day>T23:59:59Z" }, // confirm end on HLTV`,
    );
  }
  console.log(
    `\nThen: verify-lock-schedule + verify-swiss-results, ship, ` +
      `GET /api/standings/refresh to warm.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`[check-stage3-source] error: ${(err as Error).message}`);
  process.exit(1);
});
