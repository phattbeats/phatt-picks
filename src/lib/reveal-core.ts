/**
 * Pick-visibility gate (rule: picks hidden until stage lock).
 *
 * A player's individual picks are secret while a stage is still open for
 * editing. They become public only once the stage is LOCKED. Scores are
 * always public — only the underlying team choices are masked pre-lock.
 *
 * "Lock" maps to the layout's `picks_allowed` flag: while picks are allowed
 * the stage is open (hide); once Valve flips it off the stage is locked
 * (reveal). A resolved outcome is treated as proof of lock too — you cannot
 * have a result for a stage whose picks are still editable.
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under `node` without the Next path-alias resolver.
 */

export interface LockableGroup {
  picks_allowed: boolean;
}

/**
 * Is this group's stage locked (picks editable window closed)?
 * `hasResolvedOutcome` = at least one slot in the group already has a result.
 */
export function isStageLocked(group: LockableGroup, hasResolvedOutcome = false): boolean {
  return group.picks_allowed === false || hasResolvedOutcome === true;
}

/**
 * Should a player's pick for this group be revealed to others?
 * Identical to lock state — the default is to hide; revealing is the exception.
 */
export function arePicksRevealed(group: LockableGroup, hasResolvedOutcome = false): boolean {
  return isStageLocked(group, hasResolvedOutcome);
}

/**
 * Inverse of isStageLocked: can a player still edit picks in this group?
 * The write path uses this to reject POST /api/picks once the stage closes —
 * "saving a pick == locking it" only makes sense while writes are accepted.
 */
export function isStageWritable(group: LockableGroup, hasResolvedOutcome = false): boolean {
  return group.picks_allowed === true && hasResolvedOutcome !== true;
}
