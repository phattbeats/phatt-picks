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
 * Committed IEM Cologne 2026 per-stage lock schedule.
 *
 * EMPTY until Brandon commits the published lock times (PHA-856). The section
 * ids below map to the committed cologne-layout fixture:
 *   105 Stage I · 106 Stage II · 107 Stage III ·
 *   108 Quarterfinals · 109 Semifinals · 110 Grand Final
 *
 * To wire the clock, fill in the authoritative UTC lock instant per stage, e.g.
 *   105: "2026-06-01T09:00:00Z",
 * Sections left out (or set to a non-ISO / past placeholder) simply show no
 * countdown — that is the intended, truthful default.
 */
export const COLOGNE_LOCK_SCHEDULE: LockSchedule = {
  // 105: "2026-06-01T09:00:00Z",
  // 106: "...",
  // 107: "...",
  // 108: "...",
  // 109: "...",
  // 110: "...",
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
