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
