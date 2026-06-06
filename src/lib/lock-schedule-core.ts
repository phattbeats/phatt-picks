/**
 * Per-stage pick-lock schedule (pure, PHA-856).
 *
 * The countdown clock in mockup-02 ("00:58:14 until picks lock") needs a real
 * per-stage lock timestamp. We confirmed Valve's layout/predictions payload
 * carries NO lock/close time per section — sections only expose
 * `picks_allowed`, teams and pick slots (see stage-gate-core). So the only
 * truthful source is a committed schedule, the same way the event is otherwise
 * config-driven.
 *
 * Design rule — never fabricate a clock. A section's lock time lives here only
 * once it is the published, authoritative time. Until then `lockTimeForSection`
 * returns `null` and the <LockCountdown> renders nothing rather than counting
 * down to a made-up moment. The stage-gate (`isStagePickable`) remains the
 * source of truth for whether a stage is actually open; this schedule is purely
 * the human-facing "time remaining" hint layered on top.
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under `node`.
 */

/** sectionId -> ISO-8601 lock instant (UTC, e.g. "2026-06-01T09:00:00Z"). */
export type LockSchedule = Readonly<Record<number, string>>;

/**
 * Committed IEM Cologne 2026 per-stage lock schedule (PHA-865).
 *
 * Section ids map to the committed cologne-layout fixture:
 *   105 Stage I · 106 Stage II · 107 Stage III ·
 *   108 Quarterfinals · 109 Semifinals · 110 Grand Final
 *
 * LOCK SEMANTICS: a stage's picks lock when its first match begins — that is
 * also when Valve flips `picks_allowed` (the stage-gate source of truth). So
 * each value below is the UTC instant of the stage's day-1 first match.
 *
 * SWISS STAGES are lit: HLTV, Liquipedia and cs.money all give a 12:30 CEST
 * (= 10:30 UTC) first match for Stage 1 (Jun 2), Stage 2 (Jun 6) and Stage 3.
 * Stage 3's date is Liquipedia/cs.money's Jun 11 (Wikipedia says Jun 12) —
 * confirmed with Brandon on PHA-865 before go-live.
 *
 * PLAYOFF sections (108/109/110) stay DARK on purpose: the bracket runs in the
 * Jun 18–21 window but the per-round day + start time are still TBD on every
 * source. A null value renders no countdown — the truthful default until the
 * playoff schedule is published. Fill these in once authoritative.
 */
export const COLOGNE_LOCK_SCHEDULE: LockSchedule = {
  105: "2026-06-02T10:30:00Z", // Stage I  — Jun 2, 12:30 CEST first match
  106: "2026-06-06T10:30:00Z", // Stage II — Jun 6, 12:30 CEST first match
  107: "2026-06-11T10:30:00Z", // Stage III — Jun 11, 12:30 CEST first match
  // 108: Quarterfinals — Jun 18–21 window, per-round time TBD
  // 109: Semifinals    — Jun 18–21 window, per-round time TBD
  // 110: Grand Final   — Jun 21 (likely), time TBD
};

/**
 * Human stage names per section id — the single committed source for the
 * "Stage I / II / III" labels. Kept beside the schedule so a label and its lock
 * instant can never drift. Used by the pre-lock reminder copy (PHA-929).
 */
export const COLOGNE_SECTION_NAMES: Readonly<Record<number, string>> = {
  105: "Stage I",
  106: "Stage II",
  107: "Stage III",
  108: "Quarterfinals",
  109: "Semifinals",
  110: "Grand Final",
};

/** A section's published lock instant paired with its display name. */
export interface StageLock {
  name: string;
  /** UTC ISO lock instant. */
  lockAt: string;
}

/**
 * Derive the {sectionId: {name, lockAt}} map the pre-lock reminder job iterates
 * over from the committed lock schedule + section names — so there is exactly
 * ONE source of truth for stage cutoffs (PHA-929). Previously the reminder job
 * read a separate STAGE_LOCKS_JSON env (empty by default → it silently never
 * fired); deriving from COLOGNE_LOCK_SCHEDULE means a reminder fires for the same
 * instant the countdown clock and the pick lock-gate already use.
 *
 * Only sections with a valid published lock instant are included — a section
 * without one (the playoff sections) is skipped, never handed a fabricated
 * cutoff. A section missing a name falls back to "Section {id}". Pure; injectable
 * for tests and for future majors.
 */
export function stageLocksFromSchedule(
  schedule: LockSchedule = COLOGNE_LOCK_SCHEDULE,
  names: Readonly<Record<number, string>> = COLOGNE_SECTION_NAMES,
): Record<number, StageLock> {
  const out: Record<number, StageLock> = {};
  for (const key of Object.keys(schedule)) {
    const sectionId = Number(key);
    const lockAt = lockTimeForSection(sectionId, schedule);
    if (lockAt === null) continue;
    out[sectionId] = { name: names[sectionId] ?? `Section ${sectionId}`, lockAt };
  }
  return out;
}

/** A stage's competition window — the inclusive date span over which it plays. */
export interface MatchWindow {
  /** First moment of the first play day (UTC ISO). */
  start: string;
  /** Last moment of the last play day (UTC ISO). */
  end: string;
}

/**
 * Committed per-stage competition windows (PHA-902). A Swiss stage plays over
 * several days, and the live HLTV standings/bracket only change while games are
 * being played — so the hourly on-read refresh is gated to these windows
 * (`isWithinMatchWindow`) and stays idle on off-days (before a stage starts,
 * after it's decided, between stages). Brandon: "hourly refresh is also only
 * needed on dates where games are being played."
 *
 * Dates are the confirmed HLTV event spans (events 9028 / 9029):
 *   Stage 1 — Jun 2–5 · Stage 2 — Jun 6–9.
 * Same truthful-by-construction rule as the lock schedule: a window lives here
 * only once it's the published, authoritative span. A section with no committed
 * window isn't suppressed (isWithinMatchWindow returns true) — better to refresh
 * a stage we haven't dated than to wrongly freeze it. Add Stage III / playoffs
 * here once their HLTV source + dates are confirmed.
 */
export const COLOGNE_MATCH_WINDOWS: Readonly<Record<number, MatchWindow>> = {
  105: { start: "2026-06-02T00:00:00Z", end: "2026-06-05T23:59:59Z" }, // Stage I   — Jun 2–5
  106: { start: "2026-06-06T00:00:00Z", end: "2026-06-09T23:59:59Z" }, // Stage II  — Jun 6–9
  107: { start: "2026-06-11T00:00:00Z", end: "2026-06-14T23:59:59Z" }, // Stage III — Jun 11–14
};

/**
 * Is `nowMs` inside the section's committed competition window — i.e. is today a
 * day this stage plays games? Used to gate the live-standings hourly refresh so
 * it only crawls on match days. A section with no committed window returns true
 * (don't suppress an undated stage); a malformed window also returns true (fail
 * open — never freeze the data because of a bad date). `nowMs` is injected to
 * keep this pure and the verify harness deterministic.
 */
export function isWithinMatchWindow(
  sectionId: number,
  nowMs: number,
  windows: Readonly<Record<number, MatchWindow>> = COLOGNE_MATCH_WINDOWS,
): boolean {
  const w = windows[sectionId];
  if (!w) return true; // no committed window — don't suppress (safe default)
  const start = Date.parse(w.start);
  const end = Date.parse(w.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return true; // bad date — fail open
  return nowMs >= start && nowMs <= end;
}

/**
 * How long BEFORE a stage's lock (= its first match) its live bracket goes live
 * (PHA-943). Brandon: "the bracket should go live 24 hours before the start of
 * the stage, or whenever the first round of matches are announced." The 24h lead
 * is the committed trigger; the "or whenever announced" half is data-driven — the
 * crawl window opens at the same instant (`isWithinRefreshWindow`), so the moment
 * HLTV publishes the opening matchups inside that window they're picked up and
 * rendered. Future majors inherit this for free by filling COLOGNE_LOCK_SCHEDULE.
 */
export const BRACKET_REVEAL_LEAD_MS = 24 * 60 * 60_000;

/**
 * The UTC instant a section's live bracket should first appear: `lockAt − 24h`.
 * Returns `null` when the stage has no published lock (the playoff sections) —
 * those reveal by seeding (`isStagePickable`), never by a fabricated clock. Pure;
 * `leadMs`/`schedule` injected for tests and future majors.
 */
export function bracketRevealTime(
  sectionId: number,
  schedule: LockSchedule = COLOGNE_LOCK_SCHEDULE,
  leadMs: number = BRACKET_REVEAL_LEAD_MS,
): string | null {
  const iso = lockTimeForSection(sectionId, schedule);
  if (iso === null) return null;
  return new Date(Date.parse(iso) - leadMs).toISOString();
}

/**
 * Has a section's bracket-reveal instant (`lockAt − 24h`) passed? `false` when no
 * lock time is published (playoff sections stay governed by seeding). Drives both
 * the crawl window and whether the picks page renders the bracket while picks are
 * still open. `nowMs` injected to stay pure and deterministic.
 */
export function isBracketRevealed(
  sectionId: number,
  nowMs: number,
  schedule: LockSchedule = COLOGNE_LOCK_SCHEDULE,
  leadMs: number = BRACKET_REVEAL_LEAD_MS,
): boolean {
  const reveal = bracketRevealTime(sectionId, schedule, leadMs);
  if (reveal === null) return false;
  return Date.parse(reveal) <= nowMs;
}

/**
 * Should the live standings/bracket crawl run for this section right now
 * (PHA-943)? The refresh window OPENS 24h before the stage's lock — so the
 * opening matchups land before picks even close — and CLOSES at the end of its
 * committed competition window (no point crawling a decided stage). This widens
 * the old play-days-only gate (`isWithinMatchWindow`) earlier by the reveal lead.
 *
 * Fallbacks keep it safe by construction:
 *   • no published lock (playoffs) → defer to `isWithinMatchWindow` (old behavior);
 *   • revealed but no committed window end → keep refreshing (don't freeze an
 *     undated stage); a malformed end likewise fails open.
 * `nowMs` injected; pure.
 */
export function isWithinRefreshWindow(
  sectionId: number,
  nowMs: number,
  schedule: LockSchedule = COLOGNE_LOCK_SCHEDULE,
  windows: Readonly<Record<number, MatchWindow>> = COLOGNE_MATCH_WINDOWS,
): boolean {
  const reveal = bracketRevealTime(sectionId, schedule);
  if (reveal === null) return isWithinMatchWindow(sectionId, nowMs, windows);
  const startMs = Date.parse(reveal);
  const w = windows[sectionId];
  if (!w) return nowMs >= startMs; // revealed, no committed end — keep refreshing
  const end = Date.parse(w.end);
  if (Number.isNaN(end)) return nowMs >= startMs; // bad end — don't freeze
  return nowMs >= startMs && nowMs <= end;
}

/**
 * Resolve the committed lock instant for a section, or `null` when none is
 * published (or the stored value isn't a valid future-or-any ISO instant).
 * Returning `null` is what makes the countdown degrade to "no clock" instead of
 * rendering a fabricated timer.
 */
export function lockTimeForSection(
  sectionId: number,
  schedule: LockSchedule = COLOGNE_LOCK_SCHEDULE,
): string | null {
  const iso = schedule[sectionId];
  if (typeof iso !== "string" || iso.length === 0) return null;
  if (Number.isNaN(Date.parse(iso))) return null;
  return iso;
}

/**
 * Has a section's published lock instant already passed (PHA-898)?
 *
 * "A stage's picks lock when its first match begins" — the same instant Valve
 * flips `picks_allowed` off (see the schedule doc above). Our committed layout
 * fixture is frozen all-open, so it never carries that flip; until a live Valve
 * fetch lands on the render path, the published schedule is the truthful signal
 * that Stage I (Jun 2) has begun and its picks are closed. The stage-gate
 * (`isStagePickable`) and the picks write-guard both consult this so a stage
 * that has started shows Locked and refuses new writes, even against the stale
 * all-open fixture.
 *
 * `nowMs` is injected (not read) to keep this pure and the verify harness
 * deterministic. Returns false when no lock time is published (e.g. the playoff
 * sections) — those stay governed by seeding / `picks_allowed` as before, never
 * by a fabricated time.
 */
export function isLockTimePassed(
  sectionId: number,
  nowMs: number,
  schedule: LockSchedule = COLOGNE_LOCK_SCHEDULE,
): boolean {
  const iso = lockTimeForSection(sectionId, schedule);
  if (iso === null) return false;
  return Date.parse(iso) <= nowMs;
}
