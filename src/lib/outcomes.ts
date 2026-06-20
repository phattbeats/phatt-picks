/**
 * Outcome ingestion (server-only).
 *
 * Resolves stage results into the StageOutcome table, which the leaderboard
 * scores against. Source precedence (spec):
 *   1. Valve oracle — IF the running event exposes results. Probed first.
 *   2. Liquipedia MediaWiki API — fallback. Polite client in ./liquipedia.
 *
 * "Cache hard": a finished match never changes, so a resolved StageOutcome row
 * is terminal. We compute the set of still-unresolved slots from the layout vs.
 * the DB and only query a source when something is actually missing — once the
 * tournament fully resolves we stop calling out entirely. Combined with the
 * per-source rate limiter, this keeps us well inside Liquipedia's API terms.
 *
 * Graceful by contract (rules #7/#8): a source outage logs and returns what we
 * already have; it never throws into the request path or wipes stored results.
 */

import { after } from "next/server";
import { prisma } from "./db";
import { getCommittedLayout } from "./layout";
import {
  normalizeOutcomes,
  pickLockedUnresolvedSlots,
  resolveOutcomesFromLayout,
  detectStalePlayoffOutcomes,
  PLAYOFF_RESOLVE_GRACE_MS,
  type NormalizedOutcome,
  type RawResolvedSlot,
} from "./outcomes-core";
import { fetchLiquipediaResults, LiquipediaThrottledError } from "./liquipedia";
import { fetchTournamentLayout } from "./valve";
import { isEventFrozenById } from "./event-freeze";
import { cacheLiveLayout } from "./layout-state";
import { writeRankSnapshots } from "./rank-snapshot";
import { getSwissStandings, getSwissBracket, ingestStandingsNow, standingsSectionIds } from "./swiss-results";
import { bracketMatchRecords, bracketTerminalRecords } from "./swiss-bracket-core";
import { deriveClinchedSlots, findContradictedSlots } from "./swiss-clinch-core";
import { bucketSwissSlots, isSwissSection } from "./swiss-bucket-core";
import {
  isLockTimePassed,
  isWithinRefreshWindow,
  COLOGNE_PLAYOFF_SCHEDULE,
  playoffSectionIds,
} from "./lock-schedule-core";

export interface IngestSummary {
  eventId: number;
  source: "valve" | "liquipedia" | "none";
  resolvedBefore: number;
  resolvedAfter: number;
  written: number;
  rejected: number;
  error?: string;
  /** Why no source call happened — set when source === "none". */
  reason?: "no-locked-unresolved" | "fully-resolved" | "throttled" | "source-error";
}

/**
 * Probe the Valve oracle for resolved results (PHA-869 — Brandon-approved source).
 *
 * Valve's GetTournamentLayout carries the official answer key in each pick slot's
 * `pickids` once a stage resolves (empty pre-event). This is the preferred,
 * slot-correct source: we read results from the very layout players picked into,
 * so no external slot-ordering guess is needed (the reason Liquipedia can't
 * resolve the set-valued Swiss buckets). resolveOutcomesFromLayout applies the
 * per-slot policy (single pickid → resolved; multi → ambiguous, left for live
 * confirmation; locked groups only).
 *
 * Graceful by contract (rules #7/#8): any failure — STEAM_API_KEY unset, a
 * non-200, an unparseable body — logs and returns null so ingest falls through
 * to the Liquipedia fallback and never throws into the read/request path.
 * Returns null (not []) when nothing is resolved so the caller treats "Valve had
 * nothing" the same as "Valve unavailable" and still consults the fallback.
 *
 * NOTE: the resolved `pickids` shape can only be confirmed against real data at
 * the stage-1 opener (Jun 2) — pre-event every slot is empty, so this path is a
 * structural no-op until then (proven offline by verify-outcomes-oracle).
 */
async function tryValveOracle(eventId: number): Promise<RawResolvedSlot[] | null> {
  try {
    const envelope = await fetchTournamentLayout(eventId);
    const live = envelope?.result;
    if (!live?.sections) return null;
    // Free overlay refresh (PHA-896): this same payload carries the live seeded
    // teams + picks_allowed the picks UI overlays. Cache it while we have it so
    // an outcomes tick also advances the layout state. Non-fatal.
    await cacheLiveLayout(eventId, envelope).catch(() => {});
    const { resolved, ambiguous } = resolveOutcomesFromLayout(live);
    if (ambiguous.length > 0) {
      console.warn(
        `[outcomes] Valve layout reported ${ambiguous.length} slot(s) with multiple ` +
          `correct pickids (bucket/set semantics) — left unresolved pending live ` +
          `confirmation at the stage-1 opener:`,
        ambiguous,
      );
    }
    return resolved.length > 0 ? resolved : null;
  } catch (e) {
    console.error(
      "[outcomes] Valve oracle (GetTournamentLayout) failed (non-fatal):",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Ingest outcomes for an event. Probes the live Valve layout each tick (the
 * only authoritative lock/result source — the committed fixture never flips
 * `picks_allowed`); resolveOutcomesFromLayout self-gates on the live state so
 * open stages are a no-op. Idempotent: already-resolved slots are filtered out
 * before persist, so re-running after full resolution writes nothing.
 */
export async function ingestOutcomes(eventId: number): Promise<IngestSummary> {
  const layout = getCommittedLayout();

  const existing = await prisma.stageOutcome.findMany({
    where: { eventId },
    select: { sectionId: true, groupId: true, slotIndex: true },
  });
  const resolvedKey = new Set(existing.map((o) => `${o.sectionId}:${o.groupId}:${o.slotIndex}`));
  const resolvedBefore = resolvedKey.size;

  let raw: RawResolvedSlot[] = [];
  let source: "valve" | "liquipedia" | "none" = "none";
  let error: string | undefined;

  try {
    // ALWAYS probe the Valve oracle first. The lock state can only come from the
    // LIVE layout (GetTournamentLayout): our committed fixture is permanently
    // `picks_allowed:true`, so gating on it (the old behavior) meant the oracle
    // was NEVER reached and outcomes/scoring stayed frozen at 0 all event —
    // PHA-886. resolveOutcomesFromLayout self-gates on the live `picks_allowed`,
    // so this is a no-op while a stage is open and resolves only genuinely-locked
    // slots. Rate-limited upstream by refreshOutcomesOnRead's 30s cluster claim.
    const valve = await tryValveOracle(eventId);
    if (valve && valve.length > 0) {
      raw = valve;
      source = "valve";
    } else {
      // Liquipedia fallback stays gated on locked-unresolved slots so it never
      // hammers the source pre-event (PHA-844). Against the all-open committed
      // fixture this is always [] — and Liquipedia can't resolve this event's
      // Swiss buckets anyway (PHA-869) — so it stays dormant; Valve is the live
      // source of truth. We short-circuit here only when Valve had nothing AND
      // no committed-locked slot exists to justify a fallback request.
      const lockedUnresolved = pickLockedUnresolvedSlots(layout, resolvedKey);
      if (lockedUnresolved.length === 0) {
        return {
          eventId,
          source: "none",
          resolvedBefore,
          resolvedAfter: resolvedBefore,
          written: 0,
          rejected: 0,
          reason: resolvedBefore > 0 ? "fully-resolved" : "no-locked-unresolved",
        };
      }
      // Fallback: Liquipedia. The bracket page + slot mapper are event-specific;
      // pre-tournament this yields [] (no completed matches yet).
      raw = await fetchLiquipediaResults("IEM_Cologne_2026", () => null);
      source = "liquipedia";
    }
  } catch (e) {
    // Persisted throttle blocked the call: not an outage, just "try later".
    if (e instanceof LiquipediaThrottledError) {
      return {
        eventId,
        source: "none",
        resolvedBefore,
        resolvedAfter: resolvedBefore,
        written: 0,
        rejected: 0,
        reason: "throttled",
      };
    }
    // Source outage: keep what we have, report, do not throw into the caller.
    error = e instanceof Error ? e.message : String(e);
    return {
      eventId,
      source: "none",
      resolvedBefore,
      resolvedAfter: resolvedBefore,
      written: 0,
      rejected: 0,
      error,
      reason: "source-error",
    };
  }

  // Only persist slots not already resolved (terminal rows are never rewritten).
  const fresh = raw.filter((s) => !resolvedKey.has(`${s.sectionId}:${s.groupId}:${s.slotIndex}`));
  const { outcomes, rejected } = normalizeOutcomes(layout, fresh, source === "valve" ? "valve" : "liquipedia");

  await persistOutcomes(eventId, outcomes);

  // Freeze cumulative standings at this resolution for delta arrows + Stage
  // Reveal (PHA-858), but only when new outcomes actually landed. Graceful by
  // contract (rules #7/#8): a snapshot failure must never break the ingest
  // response — the leaderboard still scores live, arrows simply degrade.
  if (outcomes.length > 0) {
    try {
      await writeRankSnapshots(eventId);
    } catch (e) {
      console.error("[outcomes] rank-snapshot write failed (non-fatal):", e);
    }
  }

  return {
    eventId,
    source,
    resolvedBefore,
    resolvedAfter: resolvedBefore + outcomes.length,
    written: outcomes.length,
    rejected: rejected.length,
    error,
  };
}

// Dedicated refresh slot for the on-read driver (PHA-866), kept separate from the
// "liquipedia" parse throttle so this gates how often a refresh is *attempted*
// across the whole cluster — not just the API call deep inside ingestOutcomes.
const OUTCOMES_REFRESH_SOURCE = "outcomes-refresh";
const OUTCOMES_REFRESH_MIN_INTERVAL_MS = 30_000;

/**
 * Atomically claim the outcomes refresh slot — mirrors hltv.claimRefreshSlot
 * (PHA-863). Returns true iff the 30s floor has elapsed (or no row exists) AND
 * this caller won the race; under concurrency exactly one caller wins. A single
 * `updateMany` guarded by `lastCallAt < floor` is serialized by SQLite, so only
 * one flips the stamp; a count of 0 is disambiguated by a `create` that succeeds
 * only on the first-ever call. Best-effort: any DB error resolves to "allowed"
 * so a storage hiccup never permanently blocks the driver.
 */
async function claimOutcomesRefreshSlot(): Promise<boolean> {
  const now = new Date();
  const floor = new Date(now.getTime() - OUTCOMES_REFRESH_MIN_INTERVAL_MS);
  try {
    const res = await prisma.sourceState.updateMany({
      where: { source: OUTCOMES_REFRESH_SOURCE, lastCallAt: { lt: floor } },
      data: { lastCallAt: now },
    });
    if (res.count > 0) return true; // won the slot: floor had elapsed
    // INSERT OR IGNORE is atomic — succeeds only when no row exists, silently
    // skips otherwise (same fix as hltv.claimRefreshSlot). Avoids the P2002 that
    // `create` throws (and Prisma logs) when workers race at startup.
    // NB: id + updatedAt are NOT NULL with only client-side Prisma defaults
    // (@default(cuid()) / @updatedAt), so a raw insert MUST supply them or the
    // row silently never inserts (OR IGNORE swallows the NOT NULL violation) —
    // which would permanently wedge this claim on a fresh DB. Generate the id in
    // SQL (randomblob) and stamp updatedAt = now.
    const inserted = await prisma.$executeRaw`
      INSERT OR IGNORE INTO "SourceState" ("id", "source", "lastCallAt", "updatedAt")
      VALUES (lower(hex(randomblob(16))), ${OUTCOMES_REFRESH_SOURCE}, ${now}, ${now})
    `;
    return inserted > 0; // 1 = first-ever refresh; 0 = within floor or lost the race
  } catch {
    return true; // DB hiccup — don't let storage permanently block the driver
  }
}

/**
 * On-read self-refresh of outcomes (PHA-866). The live read surfaces call this so
 * the leaderboard / rank snapshots / Stage Reveal track official results as
 * matches finish, with NO external cron — the ingest route is owner/session-gated
 * (PHA-861), so a headless scheduler can't drive it anyway.
 *
 * Mirrors the news wire's read-path refresh (PHA-863, refreshWireOnRead): one
 * ATOMIC `claimOutcomesRefreshSlot` gates the whole refresh against the 30s floor
 * — lose the claim → no-op (warm window or a concurrent render already holds it),
 * win it → DEFER the slow ingest past the response via `after` so it never adds to
 * page latency. The slot is already stamped by the claim, so concurrent and
 * subsequent renders (across processes — the claim is DB-backed, not in-memory)
 * back off regardless of when the deferred ingest finishes. Never throws.
 *
 * ingestOutcomes is idempotent, event-gated (zero source calls pre-event / when
 * fully resolved — PHA-844), cache-hard, and bounded by the Liquipedia fetch
 * timeout; rank snapshots + Stage Reveal refresh transitively inside it.
 */
export async function refreshOutcomesOnRead(eventId: number): Promise<void> {
  if (await isEventFrozenById(eventId)) return; // PHA-949/954: frozen (effectively archived) Majors never re-crawl
  if (!(await claimOutcomesRefreshSlot())) return; // within floor or lost the race — no-op
  runDeferred(async () => {
    // Valve / Liquipedia answer key (a no-op for the set-valued Swiss buckets it
    // can't resolve), THEN the HLTV bridge that DOES resolve those buckets from
    // the live standings already crawled for the picks-page bracket (PHA-918).
    await ingestOutcomes(eventId);
    await bridgeSwissOutcomes(eventId);
  });
}

/**
 * Bridge live HLTV Swiss standings → StageOutcome (PHA-918).
 *
 * Why this exists: scoring reads StageOutcome, but Valve's GetTournamentLayout
 * returns set-valued pickids for each Swiss slot, which the oracle leaves
 * "ambiguous" — so a Swiss stage never resolves there and the leaderboard sits at
 * zero even after teams clinch. The picks-page bracket already shows live results
 * because it reads the HLTV standings cache (PHA-902); the leaderboard did not.
 * This closes that gap: it reads the SAME warm cache, derives each team's clinched
 * pick bucket from its terminal W-L record, and writes the resolved slots so the
 * leaderboard, player pages, compare, reveal, and rank snapshots all score off
 * the live results — "when the picks page updates, the leaderboard updates too".
 *
 * Cheap + safe: reads the already-crawled cache (no network), only resolves LOCKED
 * Swiss sections, writes only terminal/idempotent rows (deriveClinchedSlots never
 * rewrites a filled slot), and validates every row against the layout before
 * persisting. Graceful by contract: any failure logs and returns what we had.
 * Returns the number of newly-resolved slots.
 */
export async function bridgeSwissOutcomes(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<number> {
  const layout = getCommittedLayout();
  const matchTeams = layout.teams.map((t) => ({ pickid: t.pickid, name: t.name }));
  let written = 0;

  for (const section of layout.sections) {
    if (!isSwissSection(section.sectionid)) continue;
    // Results can only exist once the pick window has closed. Schedule-driven
    // lock (PHA-898), independent of the fixture's picks_allowed flag.
    if (!isLockTimePassed(section.sectionid, nowMs)) continue;

    // Gather terminal-record candidates from EVERY reliable source in the SAME
    // cached crawl, then keep the most-current (most games played) record per
    // team. Three sources, all read off one crawl:
    //   1. the W-L standings TABLE — richest, but JS-rendered, so it doesn't
    //      always land in the crawl markdown (rows = 0);
    //   2. the bracket's MATCH cells — server-rendered popup-json, present even
    //      when the table isn't, tallied into series records (PHA-1109);
    //   3. the bracket's TERMINAL columns — the original PHA-1044 fallback.
    // Merging (not table-OR-bracket) is what fixes the PHA-1109 freeze: a 0:3
    // elimination resolves the moment ANY source shows it, instead of going
    // unscored because the table was absent and the terminal columns parsed
    // nothing. Swiss records grow monotonically, so "most games played" is the
    // most-current read when two sources disagree (e.g. a stale cached table).
    const byPick = new Map<number, { pickid: number; wins: number; losses: number }>();
    const consider = (r: { pickid: number; wins: number; losses: number }) => {
      const prev = byPick.get(r.pickid);
      if (!prev || r.wins + r.losses > prev.wins + prev.losses) byPick.set(r.pickid, r);
    };

    let live;
    try {
      live = await getSwissStandings(eventId, section.sectionid, matchTeams);
    } catch (e) {
      console.error("[outcomes] HLTV bridge read failed (non-fatal):", e);
      live = null;
    }
    if (live) {
      for (const r of live.rows) {
        if (r.pickid != null) consider({ pickid: r.pickid, wins: r.wins, losses: r.losses });
      }
    }

    let bracket;
    try {
      bracket = await getSwissBracket(eventId, section.sectionid, matchTeams);
    } catch (e) {
      console.error("[outcomes] HLTV bridge bracket read failed (non-fatal):", e);
      bracket = null;
    }
    if (bracket) {
      for (const r of bracketMatchRecords(bracket.rounds)) consider(r);
      for (const r of bracketTerminalRecords(bracket.rounds)) consider(r);
    }

    const standings = [...byPick.values()];
    if (standings.length === 0) continue;

    let existing = await prisma.stageOutcome.findMany({
      where: { eventId, sectionId: section.sectionid },
      select: { groupId: true, slotIndex: true, winnerPickId: true },
    });

    // Self-heal (PHA-1109): a slot resolved off a stale/partial crawl can hold the
    // WRONG winner, and the never-rewrite rule would freeze that error forever —
    // blocking the team that actually clinched the bucket (B8's 0:3, Spirit's 3:0)
    // from ever scoring. Evict any slot whose stored winner the CURRENT live record
    // provably contradicts, then re-derive so the correct team takes the freed slot.
    // Records are monotonic and terminal records are permanent, so this converges
    // (a corrected slot can't be contradicted again) and never thrashes.
    const contradicted = findContradictedSlots(section, standings, existing, bucketSwissSlots);
    if (contradicted.length > 0) {
      await prisma.stageOutcome.deleteMany({
        where: {
          OR: contradicted.map((c) => ({
            eventId,
            sectionId: section.sectionid,
            groupId: c.groupId,
            slotIndex: c.slotIndex,
          })),
        },
      });
      const evicted = new Set(contradicted.map((c) => `${c.groupId}:${c.slotIndex}`));
      existing = existing.filter((e) => !evicted.has(`${e.groupId}:${e.slotIndex}`));
      console.warn(
        `[outcomes] self-heal: evicted ${contradicted.length} contradicted slot(s) in section ${section.sectionid} (stale winners ruled out by live record):`,
        contradicted.map((c) => `slot ${c.slotIndex}←pick ${c.winnerPickId}`).join(", "),
      );
      written += contradicted.length;
    }

    const fresh = deriveClinchedSlots(section, standings, existing, bucketSwissSlots);
    if (fresh.length === 0) continue;

    const raw: RawResolvedSlot[] = fresh.map((r) => ({ sectionId: section.sectionid, ...r }));
    const { outcomes } = normalizeOutcomes(layout, raw, "hltv");
    await persistOutcomes(eventId, outcomes);
    written += outcomes.length;
  }

  // Freeze cumulative standings whenever new outcomes landed (delta arrows + Stage
  // Reveal, PHA-858). Non-fatal: a snapshot miss never breaks the bridge.
  if (written > 0) {
    try {
      await writeRankSnapshots(eventId);
    } catch (e) {
      console.error("[outcomes] HLTV bridge rank-snapshot write failed (non-fatal):", e);
    }
  }
  return written;
}

export interface LiveResultsTick {
  eventId: number;
  ingested: number;
  resolved: number;
  /** Playoff matches that are past their resolve deadline but still un-green —
   *  the stale-outcome watchdog count (PHA-1273). 0 in the healthy case. */
  stale: number;
}

/**
 * Synchronous live-results driver for the in-process scheduler (PHA-1109).
 *
 * The on-read drivers (refreshStandingsOnRead / refreshOutcomesOnRead) DEFER
 * their HLTV crawl + bridge past the response via `after()` — which does not
 * fire reliably in the Next standalone production server. The symptom: during a
 * live stage the standings cache (and the StageOutcome answer key the
 * leaderboard scores off) can freeze for hours with nothing to notice. PHA-1109:
 * a 0-3 elimination (B8) stayed un-green and unscored for ~19h because the crawl
 * never ran — every page load STAMPED the ~1h refresh floor at claim time, then
 * deferred a crawl that never executed, perpetually wedging the floor while no
 * crawl ever landed, and locking out the synchronous warm route too.
 *
 * This is the traffic- and after()-independent path the instrumentation
 * scheduler calls on a fixed tick: force-crawl every in-window standings section
 * (ingestStandingsNow bypasses the floor — the tick cadence is the rate limit),
 * then bridge the freshly-warmed cache into StageOutcome so green checkmarks AND
 * points land together the moment a team clinches. Self-gating and best-effort:
 * a frozen (effectively archived) Major no-ops, off-window sections are skipped,
 * and any single failure is logged and never throws (a stuck section can't wedge
 * the rest, and the scheduler keeps ticking).
 */
export async function refreshLiveResultsTick(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<LiveResultsTick> {
  if (await isEventFrozenById(eventId, nowMs)) return { eventId, ingested: 0, resolved: 0, stale: 0 };

  let ingested = 0;
  for (const sectionId of standingsSectionIds(eventId)) {
    if (!isWithinRefreshWindow(sectionId, nowMs)) continue; // off-window → serve cache, don't crawl
    try {
      ingested += await ingestStandingsNow(eventId, sectionId);
    } catch (e) {
      console.error(
        `[live-tick] standings ingest failed for section ${sectionId} (non-fatal):`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  let resolved = 0;

  // Valve oracle (PHA-1273). The Swiss bridge below only resolves the Swiss
  // sections (standingsSectionIds / isSwissSection) — PLAYOFF outcomes come
  // exclusively from the Valve answer key in GetTournamentLayout (ingestOutcomes),
  // which otherwise only ran on the owner's manual ingest or the unreliable
  // after()-deferred on-read path. The symptom: Cologne QF1/QF2 sat unresolved on
  // the bracket because no headless driver ever poked the oracle after the owner's
  // last manual run. Drive it here on the same traffic-independent tick so playoff
  // QF/SF/GF results turn green within a tick, exactly like Swiss clinches do.
  // Idempotent + self-gating (only locked groups with a single resolved pickid;
  // already-resolved slots are filtered before persist), so it's a cheap no-op
  // once the bracket is fully resolved.
  try {
    const summary = await ingestOutcomes(eventId);
    resolved += summary.written;
  } catch (e) {
    console.error("[live-tick] Valve oracle ingest failed (non-fatal):", e instanceof Error ? e.message : e);
  }

  try {
    resolved += await bridgeSwissOutcomes(eventId, nowMs);
  } catch (e) {
    console.error("[live-tick] outcome bridge failed (non-fatal):", e instanceof Error ? e.message : e);
  }

  // Stale-outcome watchdog (PHA-1273). The oracle above re-pokes every tick, so a
  // transiently-stuck playoff match self-heals on the next cycle — but a match that
  // stays unresolved long past when it should have finished (QF1/QF2: ~2 days behind
  // a normalizer bug) would otherwise be masked forever by that blind retry. After
  // the retry runs, reconcile the per-section resolved-match COUNT against how many
  // games the committed schedule says should be done by now, and emit a structured
  // warning naming the overdue round(s) so the silent-stuck class is observable in
  // the logs (and on the returned tick) instead of hidden. Best-effort: never throws.
  let stale = 0;
  try {
    const playoffSections = [...playoffSectionIds()];
    if (playoffSections.length > 0) {
      const rows = await prisma.stageOutcome.findMany({
        where: { eventId, sectionId: { in: playoffSections } },
        select: { sectionId: true, groupId: true },
      });
      const groupsBySection = new Map<number, Set<number>>();
      for (const r of rows) {
        const set = groupsBySection.get(r.sectionId) ?? new Set<number>();
        set.add(r.groupId);
        groupsBySection.set(r.sectionId, set);
      }
      const resolvedCounts = new Map<number, number>();
      for (const [sectionId, set] of groupsBySection) resolvedCounts.set(sectionId, set.size);
      const staleSections = detectStalePlayoffOutcomes(
        COLOGNE_PLAYOFF_SCHEDULE,
        resolvedCounts,
        nowMs,
        PLAYOFF_RESOLVE_GRACE_MS,
      );
      stale = staleSections.reduce((n, s) => n + s.missing, 0);
      if (staleSections.length > 0) {
        console.warn(
          "[live-tick] STALE playoff outcomes — re-poked the Valve oracle but these matches are overdue: " +
            staleSections
              .map(
                (s) =>
                  `section ${s.sectionId} ${s.resolved}/${s.expectedDone} resolved, ${s.missing} missing (earliest overdue ${Math.round(s.overdueByMs / 60000)}m)`,
              )
              .join("; "),
        );
      }
    }
  } catch (e) {
    console.error("[live-tick] stale-outcome watchdog failed (non-fatal):", e instanceof Error ? e.message : e);
  }

  return { eventId, ingested, resolved, stale };
}

/**
 * Run a best-effort background task without blocking (or coupling latency to) the
 * current render. Prefers Next's `after` so the work runs past the response and
 * isn't cut off; falls back to a floating promise when called outside a request
 * scope (e.g. tests). Errors are swallowed — the driver is best-effort.
 */
function runDeferred(task: () => Promise<unknown>): void {
  const run = () => {
    void task().catch((e) => console.error("[outcomes] deferred refresh failed (non-fatal):", e));
  };
  try {
    after(run);
  } catch {
    run();
  }
}

/** Upsert validated outcomes. Resolved rows are immutable — create-or-leave. */
async function persistOutcomes(eventId: number, outcomes: NormalizedOutcome[]): Promise<void> {
  if (outcomes.length === 0) return;
  await prisma.$transaction(
    outcomes.map((o) =>
      prisma.stageOutcome.upsert({
        where: {
          eventId_sectionId_groupId_slotIndex: {
            eventId,
            sectionId: o.sectionId,
            groupId: o.groupId,
            slotIndex: o.slotIndex,
          },
        },
        update: {}, // terminal — never rewrite a resolved result
        create: {
          eventId,
          sectionId: o.sectionId,
          groupId: o.groupId,
          slotIndex: o.slotIndex,
          winnerPickId: o.winnerPickId,
          source: o.source,
          resolvedAt: new Date(),
        },
      })
    )
  );
}
