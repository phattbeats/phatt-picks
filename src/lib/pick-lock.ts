/**
 * Self-sealed picks — SERVER-SIDE data access (prisma). The rules live in
 * pick-lock-core.ts; this module only loads seals and computes the stage write
 * gate the same way POST /api/picks does, so "can seal" and "can edit" can never
 * disagree with the write path.
 */

import { prisma } from "@/lib/db";
import { getEffectiveLayout } from "@/lib/layout-state";
import { isStageWritable } from "@/lib/reveal-core";
import { isLockTimePassed, lockTimeForSection } from "@/lib/lock-schedule-core";
import { getEventConfig } from "@/lib/events-core";
import { isWriteFrozenById } from "@/lib/event-freeze";
import { sealUnitFor, sectionsInUnit, type SealView } from "@/lib/pick-lock-core";

export type { SealView };


type SealRow = {
  sectionId: number;
  visibility: string;
  lockedAt: Date;
  steamDivergedAt: Date | null;
};

export function toSealView(row: SealRow | null | undefined): SealView | null {
  if (!row) return null;
  return {
    unit: row.sectionId,
    visibility: row.visibility === "public" ? "public" : "hidden",
    lockedAt: row.lockedAt.toISOString(),
    steamDiverged: row.steamDivergedAt != null,
  };
}

/** One player's seal for the unit `sectionId` belongs to (or null). */
export async function getSeal(playerId: string, eventId: number, sectionId: number) {
  return prisma.pickLock.findUnique({
    where: { playerId_eventId_sectionId: { playerId, eventId, sectionId: sealUnitFor(sectionId) } },
  });
}

/** Every seal for the event, indexed playerId → unit → row. */
export async function getEventSeals(eventId: number, playerIds?: string[]) {
  const rows = await prisma.pickLock.findMany({
    where: { eventId, ...(playerIds ? { playerId: { in: playerIds } } : {}) },
  });
  const byPlayer = new Map<string, Map<number, (typeof rows)[number]>>();
  for (const r of rows) {
    const m = byPlayer.get(r.playerId) ?? new Map();
    m.set(r.sectionId, r);
    byPlayer.set(r.playerId, m);
  }
  return {
    rows,
    /** The seal covering (player, section), resolving playoffs onto their unit. */
    sealFor(playerId: string, sectionId: number) {
      return byPlayer.get(playerId)?.get(sealUnitFor(sectionId)) ?? null;
    },
  };
}

/**
 * Is the unit still open for edits for everyone (the stage gate, ignoring
 * seals)? Mirrors POST /api/picks: archived event → closed; playoffs gate on the
 * Quarterfinals; any resolved outcome or a passed lock instant closes it.
 */
export async function unitWriteGate(eventId: number, unit: number) {
  if (await isWriteFrozenById(eventId)) return { writable: false, total: 0, sectionIds: [] as number[] };
  const layout = await getEffectiveLayout(eventId);
  const sectionIds = sectionsInUnit(unit).filter((id) => layout.sections.some((s) => s.sectionid === id));
  const gate = layout.sections.find((s) => s.sectionid === unit);
  if (!gate) return { writable: false, total: 0, sectionIds };
  const resolved = await prisma.stageOutcome.count({ where: { eventId, sectionId: { in: sectionIds } } });
  const lockedByTime = isLockTimePassed(unit, Date.now(), getEventConfig(eventId)?.lockSchedule);
  const writable = gate.groups.every((g) => isStageWritable(g, resolved > 0, lockedByTime));
  const total = layout.sections
    .filter((s) => sectionIds.includes(s.sectionid))
    .reduce((n, s) => n + s.groups.reduce((m, g) => m + g.picks.length, 0), 0);
  return { writable, total, sectionIds };
}

/** The unit's published lock instant in ms, for lead-time metrics. */
export function unitLockAtMs(eventId: number, unit: number): number | null {
  const iso = lockTimeForSection(unit, getEventConfig(eventId)?.lockSchedule);
  return iso ? Date.parse(iso) : null;
}
