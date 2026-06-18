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
 * PLAYOFF sections (108/109/110) are NOT in this Swiss map — their per-game times
 * live in COLOGNE_PLAYOFF_SCHEDULE below (committed from the published bracket,
 * PHA-1007) and fold into COLOGNE_LOCK_SCHEDULE via derivePlayoffLocks. A section
 * with no committed game time still renders no countdown — the truthful default.
 */
const COLOGNE_SWISS_LOCKS: LockSchedule = {
  105: "2026-06-02T10:30:00Z", // Stage I  — Jun 2, 12:30 CEST first match
  106: "2026-06-06T10:30:00Z", // Stage II — Jun 6, 12:30 CEST first match
  107: "2026-06-11T10:30:00Z", // Stage III — Jun 11, 12:30 CEST first match
};

/**
 * Committed IEM Cologne 2026 PER-GAME playoff schedule (PHA-1007).
 *
 * Each playoff section runs several games on the day, and the Pick'Em window for
 * the whole bracket closes when the FIRST quarterfinal begins. So unlike the
 * Swiss stages (one lock instant each) the playoffs need per-GAME times: each is
 * shown on the bracket ("Jun 18 · 12:30"), and the earliest QF time derives the
 * single playoff lock the countdown counts toward.
 *
 * Keyed by sectionId → game start instants (UTC ISO) in bracket order:
 *   108 Quarterfinals [QF1, QF2, QF3, QF4] · 109 Semifinals [SF1, SF2] · 110 Grand Final [GF].
 *
 * SAME TRUTHFUL-BY-CONSTRUCTION RULE as the lock schedule above: a game's time
 * lives here only once it is the published, authoritative time. EMPTY by default
 * → no playoff lock, no countdown, no game-time chips.
 *
 * Committed from the authoritative published bracket (PHA-1007): Liquipedia +
 * the ESL Pro Tour schedule for IEM Cologne 2026 playoffs (Jun 18–21), times
 * converted from CEST (UTC+2) to the UTC instants below. Bo3 quarters/semis,
 * Bo5 grand final:
 *   QF1 Aurora–BetBoom  Jun 18 15:45 CEST · QF2 9z–FURIA       Jun 18 19:00 CEST
 *   QF3 Spirit–G2       Jun 19 15:45 CEST · QF4 Falcons–Vitality Jun 19 19:00 CEST
 *   SF1 Jun 20 15:45 CEST · SF2 Jun 20 19:00 CEST · GF Jun 21 17:00 CEST
 */
export const COLOGNE_PLAYOFF_SCHEDULE: Readonly<Record<number, readonly string[]>> = {
  108: ["2026-06-18T13:45:00Z", "2026-06-18T17:00:00Z", "2026-06-19T13:45:00Z", "2026-06-19T17:00:00Z"],
  109: ["2026-06-20T13:45:00Z", "2026-06-20T17:00:00Z"],
  110: ["2026-06-21T15:00:00Z"],
};

/**
 * Derive each playoff section's lock instant = its EARLIEST committed game time.
 * The bracket is one Pick'Em stage that closes at the first quarterfinal, so the
 * countdown keys off section 108's earliest game; 109/110 carry their own
 * earliest only for completeness. A section with no committed games contributes
 * nothing (stays dark), so an empty COLOGNE_PLAYOFF_SCHEDULE is a no-op.
 */
function derivePlayoffLocks(
  schedule: Readonly<Record<number, readonly string[]>>,
): LockSchedule {
  const out: Record<number, string> = {};
  for (const key of Object.keys(schedule)) {
    const sectionId = Number(key);
    const times = (schedule[sectionId] ?? [])
      .filter((iso) => typeof iso === "string" && !Number.isNaN(Date.parse(iso)))
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    if (times.length > 0) out[sectionId] = times[0];
  }
  return out;
}

/**
 * The section ids that make up the single playoff bracket — derived from the
 * per-game playoff schedule (its keys ARE the playoff rounds). The whole bracket
 * is ONE Pick'Em stage: a player taps QF→SF→GF in one picker and it all locks
 * together when the first quarterfinal begins (see COLOGNE_PLAYOFF_SCHEDULE).
 *
 * This is the seam the pre-lock reminders use to treat the playoffs as a single
 * stage (one "Playoffs lock soon" warning) instead of three separate ones. A
 * future major inherits it for free by filling its own per-game playoff schedule.
 */
export function playoffSectionIds(
  schedule: Readonly<Record<number, readonly string[]>> = COLOGNE_PLAYOFF_SCHEDULE,
): Set<number> {
  return new Set(Object.keys(schedule).map(Number));
}

/**
 * Display name for the collapsed playoff Pick'Em stage in reminder copy. The
 * bracket has no single committed "stage name" the way a Swiss stage does
 * (it spans QF/SF/GF), so the one reminder reads "Playoffs picks lock in …".
 */
export const PLAYOFF_STAGE_NAME = "Playoffs";

/**
 * The full committed lock schedule: the Swiss stage locks plus the playoff
 * section locks derived from the per-game playoff schedule. Folding them here
 * means the countdown, `isLockTimePassed`, the bracket-reveal window and the
 * pre-lock reminders all read ONE source — fill `COLOGNE_PLAYOFF_SCHEDULE` and
 * the playoffs light up everywhere at once.
 */
export const COLOGNE_LOCK_SCHEDULE: LockSchedule = {
  ...COLOGNE_SWISS_LOCKS,
  ...derivePlayoffLocks(COLOGNE_PLAYOFF_SCHEDULE),
};

/**
 * The single instant the whole playoff bracket closes = the EARLIEST committed
 * playoff game across all rounds (they lock together at the first quarterfinal).
 * This is also when the playoffs' matches go live — the moment The Bleachers
 * reactions on revealed picks unlock (PHA-1211) — so a broadcast can flip its
 * copy from "coming soon" to "live" off this same instant (PHA-1245 follow-up).
 * Returns `null` when no playoff games are committed (empty schedule / a future
 * major before its bracket publishes). Pure; schedule + ids injectable.
 */
export function playoffLockTime(
  schedule: LockSchedule = COLOGNE_LOCK_SCHEDULE,
  playoffIds: ReadonlySet<number> = playoffSectionIds(),
): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const key of Object.keys(schedule)) {
    const sid = Number(key);
    if (!playoffIds.has(sid)) continue;
    const iso = lockTimeForSection(sid, schedule);
    if (iso === null) continue;
    const ms = Date.parse(iso);
    if (best === null || ms < best.ms) best = { iso, ms };
  }
  return best?.iso ?? null;
}

/**
 * The committed start instant (UTC ISO) of a single playoff game, or `null` when
 * that game has no published time yet. `matchIndex` is the game's position in its
 * round (0-based, bracket order). Pure; lets the bracket render a per-game
 * "Jun 18 · 12:30" chip only for games that have a real, authoritative time.
 */
export function playoffGameTime(
  sectionId: number,
  matchIndex: number,
  schedule: Readonly<Record<number, readonly string[]>> = COLOGNE_PLAYOFF_SCHEDULE,
): string | null {
  const times = schedule[sectionId];
  if (!times) return null;
  const iso = times[matchIndex];
  if (typeof iso !== "string" || Number.isNaN(Date.parse(iso))) return null;
  return iso;
}

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
 * without one is skipped, never handed a fabricated cutoff. A section missing a
 * name falls back to "Section {id}". Pure; injectable for tests and future majors.
 *
 * PLAYOFFS COLLAPSE TO ONE STAGE (PHA-1245). The playoff rounds (QF/SF/GF) share
 * a single bracket picker that all locks together when the FIRST quarterfinal
 * begins, so they are ONE Pick'Em stage — not three. The schedule still carries a
 * per-round lock (108=QF1, 109=SF1, 110=GF) for the countdown/reveal, but for
 * reminders we emit exactly ONE "Playoffs" cutoff at the earliest playoff game.
 * Otherwise an opted-in player got three "locks soon" pings (Quarterfinals,
 * Semifinals, Grand Final) for picks they actually lock in a single submission.
 * The single playoff lock is keyed on its own (earliest) section id so the
 * fired-key dedup in the reminder job stays stable.
 */
export function stageLocksFromSchedule(
  schedule: LockSchedule = COLOGNE_LOCK_SCHEDULE,
  names: Readonly<Record<number, string>> = COLOGNE_SECTION_NAMES,
  playoffIds: ReadonlySet<number> = playoffSectionIds(),
): Record<number, StageLock> {
  const out: Record<number, StageLock> = {};
  let earliestPlayoff: { sectionId: number; lockAt: string; lockAtMs: number } | null = null;
  for (const key of Object.keys(schedule)) {
    const sectionId = Number(key);
    const lockAt = lockTimeForSection(sectionId, schedule);
    if (lockAt === null) continue;
    if (playoffIds.has(sectionId)) {
      // Fold every playoff round into the single bracket cutoff = earliest game.
      const lockAtMs = Date.parse(lockAt);
      if (earliestPlayoff === null || lockAtMs < earliestPlayoff.lockAtMs) {
        earliestPlayoff = { sectionId, lockAt, lockAtMs };
      }
      continue;
    }
    out[sectionId] = { name: names[sectionId] ?? `Section ${sectionId}`, lockAt };
  }
  if (earliestPlayoff !== null) {
    out[earliestPlayoff.sectionId] = { name: PLAYOFF_STAGE_NAME, lockAt: earliestPlayoff.lockAt };
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
  107: { start: "2026-06-11T00:00:00Z", end: "2026-06-15T23:59:59Z" }, // Stage III — Jun 11–15 (clinches ran into Jun 15; a too-early end froze the crawl while teams were still clinching — PHA-1109)
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
 * Is `nowMs` inside ANY committed competition window — i.e. is *some* stage of
 * the event playing games right now (PHA-921)?
 *
 * The team dossier's recent-results refresh isn't section-scoped the way the
 * Swiss standings are: it crawls each team's HLTV PROFILE, which changes whenever
 * that team plays — in any stage. So the live refresh gate is "is any stage in
 * its match window", folding the same per-section windows the standings use.
 * Empty window map → true (no committed windows means don't suppress an undated
 * event); each window applies the same fail-open rules as `isWithinMatchWindow`.
 */
export function isWithinAnyMatchWindow(
  nowMs: number,
  windows: Readonly<Record<number, MatchWindow>> = COLOGNE_MATCH_WINDOWS,
): boolean {
  const ids = Object.keys(windows);
  if (ids.length === 0) return true; // no committed windows — don't suppress
  return ids.some((id) => isWithinMatchWindow(Number(id), nowMs, windows));
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
