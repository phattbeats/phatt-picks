/**
 * The Bleachers — semi-anonymous player interaction (PHA-1211, concept A).
 *
 * One player drops a fixed reaction STAMP on another player's *revealed* pick.
 * The board sees the running tally; it does NOT see who dropped what — until the
 * stage RESOLVES, at which point the mask comes off and senders are named.
 * That "masked in the moment, unmasked when the result lands" tension is the
 * whole point of the feature, and the reason the vocabulary is a fixed set:
 * fixed glyphs mean zero free text, which means zero moderation queue.
 *
 * This module is pure (no DB / network / React) so the tally + reveal rules can
 * be unit-tested in isolation, the same way swiss-bucket-core / consensus-core
 * are. The DB shape lives in prisma (model Reaction); the API route and the
 * profile page compose this with Prisma + the push stack.
 */

export type StampKind = "props" | "heat";

export interface Stamp {
  id: string;
  glyph: string;
  /** Short all-caps label shown next to the count. */
  label: string;
  /** props = respect, heat = a jab. Drives the accent colour only. */
  kind: StampKind;
}

/**
 * The fixed vocabulary. Order here is the canonical display order of the drop
 * row. Mixed tone (jabs + props) — matches the pick'em scene without opening a
 * free-text abuse surface. Adding/removing a stamp is the ONLY way the language
 * changes; an unknown stampId is rejected at the API boundary.
 */
export const STAMPS: readonly Stamp[] = [
  { id: "fire", glyph: "🔥", label: "FIRE", kind: "props" },
  { id: "called", glyph: "🎯", label: "CALLED IT", kind: "props" },
  { id: "bold", glyph: "🧠", label: "BOLD", kind: "props" },
  { id: "ice", glyph: "🧊", label: "ICE COLD", kind: "heat" },
  { id: "cope", glyph: "🗿", label: "COPE", kind: "heat" },
] as const;

const STAMP_BY_ID = new Map(STAMPS.map((s) => [s.id, s]));

export function getStamp(id: string): Stamp | undefined {
  return STAMP_BY_ID.get(id);
}

export function isValidStampId(id: string): boolean {
  return STAMP_BY_ID.has(id);
}

/** A stored reaction row, narrowed to what the tally needs. */
export interface ReactionLike {
  stampId: string;
  senderId: string;
}

/** One line in the rendered tally: a stamp, how many dropped it, did the viewer. */
export interface StampTally {
  stamp: Stamp;
  count: number;
  /** true when the signed-in viewer is one of the senders (drives the toggle). */
  mine: boolean;
}

/**
 * Aggregate raw reaction rows for a single pick into ordered tally lines.
 *
 * - Counts group by stampId across all senders (the public number).
 * - `mine` is set when viewerId is among that stamp's senders, so the UI can
 *   show the viewer's own drop as active even though everyone else is masked.
 * - Sorted by count desc, then by the canonical STAMPS order for stable ties.
 * - Unknown stampIds (e.g. a stamp retired after rows were written) are skipped
 *   rather than rendered blank.
 */
export function tallyReactions(
  rows: readonly ReactionLike[],
  viewerId: string | null,
): StampTally[] {
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const r of rows) {
    if (!STAMP_BY_ID.has(r.stampId)) continue;
    const cur = counts.get(r.stampId) ?? { count: 0, mine: false };
    cur.count += 1;
    if (viewerId !== null && r.senderId === viewerId) cur.mine = true;
    counts.set(r.stampId, cur);
  }
  const order = new Map(STAMPS.map((s, i) => [s.id, i]));
  return [...counts.entries()]
    .map(([id, v]) => ({ stamp: STAMP_BY_ID.get(id)!, count: v.count, mine: v.mine }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (order.get(a.stamp.id)! - order.get(b.stamp.id)!),
    );
}

/** Total reactions across all stamps on a pick (drives the push copy + badge). */
export function totalReactions(rows: readonly ReactionLike[]): number {
  return rows.reduce((n, r) => n + (STAMP_BY_ID.has(r.stampId) ? 1 : 0), 0);
}

/**
 * The reveal rule. Reactions are anonymous WHILE a stage is unresolved; once the
 * stage has a resolved outcome the senders are unmasked. The recipient earned
 * the right to see who talked the moment the tape dropped. Mirrors how the rest
 * of the app gates on stage resolution (reveal-core / consensus), so the
 * Bleachers can never reveal a name earlier than picks themselves are public.
 */
export function bleachersUnmasked(stageResolved: boolean): boolean {
  return stageResolved;
}

/** Stable target key for a single pick — used as the React key + cooldown id. */
export function pickTargetKey(
  sectionId: number,
  groupId: number,
  slotIndex: number,
): string {
  return `${sectionId}:${groupId}:${slotIndex}`;
}
