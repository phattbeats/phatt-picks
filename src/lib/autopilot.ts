/**
 * Major autopilot — the I/O half (PHA-1406). Gathers the per-section snapshot
 * the pure model in autopilot-core.ts reads (committed schedule + Valve's
 * cached live layout + resolved outcome counts), and runs the self-check the
 * in-process tick calls every five minutes: a `[autopilot]` log line and a push
 * to the owner's devices for each finding that needs a human, re-sent every
 * 12h while it persists. Served read-only at GET /api/autopilot.
 *
 * Server-only (prisma). Never throws into the tick.
 */

import { prisma } from "./db";
import { getEventConfig, sectionsInPlayOrder, type EventConfig } from "./events-core";
import { resolveEffectiveStatusById } from "./event-freeze";
import { getEffectiveLayout } from "./layout-state";
import { sendPushToPlayer } from "./notify";
import { marketSlugsFor } from "./spotlight-odds-core";
import {
  autopilotFindings,
  findingKey,
  findingsToAlert,
  sectionPhase,
  type AutopilotFinding,
  type SectionPhase,
  type SectionSnapshot,
} from "./autopilot-core";

export interface AutopilotStatus {
  eventId: number;
  name: string;
  status: string;
  now: string;
  sections: (SectionSnapshot & { phase: SectionPhase })[];
  findings: AutopilotFinding[];
}

/** A section's committed lock: its lockSchedule entry, else its earliest published playoff game. */
function committedLock(event: EventConfig, sectionId: number): string | null {
  const direct = event.lockSchedule[sectionId];
  if (direct) return direct;
  const games = (event.playoffSchedule[sectionId] ?? []).filter((iso) => Number.isFinite(Date.parse(iso)));
  if (games.length === 0) return null;
  return games.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

/** Build the per-section snapshot for an event. Degrades to committed-only data on any DB miss. */
export async function snapshotSections(eventId: number): Promise<SectionSnapshot[]> {
  const event = getEventConfig(eventId);
  if (!event) return [];

  const [layout, live, outcomes] = await Promise.all([
    getEffectiveLayout(eventId).catch(() => null),
    prisma.layoutCache.findUnique({ where: { eventId }, select: { id: true } }).catch(() => null),
    prisma.stageOutcome
      .groupBy({ by: ["sectionId"], where: { eventId }, _count: { _all: true } })
      .catch(() => [] as { sectionId: number; _count: { _all: number } }[]),
  ]);
  const resolvedBySection = new Map(outcomes.map((o) => [o.sectionId, o._count._all]));

  return sectionsInPlayOrder(event).map(({ sectionId, name, kind }) => {
    const section = layout?.sections.find((s) => s.sectionid === sectionId);
    const groups = section?.groups ?? [];
    const teams = groups.flatMap((g) => g.teams ?? []);
    return {
      sectionId,
      name,
      kind,
      lockAt: committedLock(event, sectionId),
      window: event.matchWindows[sectionId] ?? null,
      hasSource: sectionId in event.sectionSources,
      seeded: teams.filter((t) => Number(t.pickid) > 0).length,
      teamSlots: teams.length,
      valveOpen: live && groups.length > 0 ? groups.every((g) => g.picks_allowed !== false) : null,
      resolved: resolvedBySection.get(sectionId) ?? 0,
      slots: groups.reduce((n, g) => n + (g.picks?.length ?? 0), 0),
    };
  });
}

/** The full autopilot read for an event: phases + findings. */
export async function autopilotStatus(eventId: number, nowMs: number = Date.now()): Promise<AutopilotStatus | null> {
  const event = getEventConfig(eventId);
  if (!event) return null;
  const sections = await snapshotSections(eventId);
  const status = (await resolveEffectiveStatusById(eventId, nowMs).catch(() => null)) ?? event.status;
  return {
    eventId,
    name: event.name,
    status,
    now: new Date(nowMs).toISOString(),
    sections: sections.map((s) => ({ ...s, phase: sectionPhase(s, nowMs) })),
    findings: autopilotFindings({
      sections,
      nowMs,
      marketsAuthored: Object.keys(marketSlugsFor(eventId)).length,
    }),
  };
}

/** Findings already alerted this process lifetime → when. */
const lastAlerted = new Map<string, number>();

async function ownerPlayerId(): Promise<string | null> {
  const steamId = process.env.OWNER_STEAM_ID?.trim();
  if (!steamId) return null;
  const owner = await prisma.player.findUnique({ where: { steamId }, select: { id: true } }).catch(() => null);
  return owner?.id ?? null;
}

/**
 * The tick's self-check. Only runs for a live event (an archived or not-yet-live
 * Major has nothing to run). Logs every finding that alerts and pushes it to
 * the owner when OWNER_STEAM_ID + push are configured. Returns the alerted
 * findings. Never throws.
 */
export async function runAutopilotCheck(eventId: number, nowMs: number = Date.now()): Promise<AutopilotFinding[]> {
  try {
    const status = await autopilotStatus(eventId, nowMs);
    if (!status || status.status !== "live") return [];
    const due = findingsToAlert(status.findings, lastAlerted, nowMs);
    if (due.length === 0) return [];
    const owner = await ownerPlayerId();
    for (const f of due) {
      lastAlerted.set(findingKey(f), nowMs);
      console.warn(`[autopilot] ${f.level.toUpperCase()} ${f.code} section ${f.sectionId}: ${f.message}`);
      if (owner) {
        await sendPushToPlayer(owner, {
          title: f.level === "needs-human" ? "HOTLINE needs you" : "HOTLINE check",
          body: f.message,
          url: "/api/autopilot",
          tag: `autopilot:${findingKey(f)}`,
        }).catch(() => undefined);
      }
    }
    return due;
  } catch (err) {
    console.error("[autopilot] check failed (non-fatal):", err);
    return [];
  }
}
