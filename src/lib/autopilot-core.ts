/**
 * Major autopilot — the pure state model (PHA-1406).
 *
 * A Major runs itself once its registry entry is filled: the in-process ticks
 * (src/instrumentation.ts) lock, reveal, crawl, score, remind, archive and mint
 * with nobody watching. What they cannot do is invent a fact nobody has
 * published yet — Stage III's first match, the playoff game times, the
 * Polymarket matchups. Until now an LLM routine polled for those once a week.
 * This module replaces that poll with a deterministic check the tick runs every
 * five minutes: it derives each section's phase from the committed schedule plus
 * Valve's live layout, and names the exact config gap a human has to close and
 * when it becomes urgent.
 *
 * Pure: no prisma, no fetch, no `@/` alias, so scripts/verify-autopilot.ts runs
 * it under `node --experimental-strip-types`. The I/O half (gathering the
 * snapshot, logging, the owner push) is src/lib/autopilot.ts. docs/AUTOPILOT.md
 * is the operator's read of the same state machine.
 */

/** Where one Pick'Em section is in its life. */
export type SectionPhase =
  /** No published lock time: no countdown, no reveal, no reminders. */
  | "dark"
  /** Lock time known, more than 24h out. */
  | "scheduled"
  /** Inside the 24h pre-lock window: live bracket/standings visible, picks still open. */
  | "revealed"
  /** Locked (by our clock or by Valve) and not every slot has a result yet. */
  | "live"
  /** Every slot in the section has a result. */
  | "decided";

export type SectionKind = "swiss" | "playoff";

/** Everything the autopilot needs to know about one section, gathered by the I/O half. */
export interface SectionSnapshot {
  sectionId: number;
  name: string;
  kind: SectionKind;
  /** Committed lock instant (ISO), or null when unpublished. */
  lockAt: string | null;
  /** Committed match window, or null. */
  window: { start: string; end: string } | null;
  /** A live standings source (HLTV page) is committed for this section. */
  hasSource: boolean;
  /** Teams Valve has seeded into this section (pickid > 0). */
  seeded: number;
  /** Team slots in this section (seeded + still-TBD). */
  teamSlots: number;
  /** Valve's live `picks_allowed` (false = Valve has closed the stage); null when no live layout is cached. */
  valveOpen: boolean | null;
  /** Pick slots with a StageOutcome row. */
  resolved: number;
  /** Pick slots in the section. */
  slots: number;
}

export type FindingLevel = "needs-human" | "warn" | "info";

export interface AutopilotFinding {
  level: FindingLevel;
  /** Stable machine code, also the dedupe key with sectionId. */
  code:
    | "undated-stage-next"
    | "undated-stage"
    | "no-source-before-reveal"
    | "valve-closed-early"
    | "valve-still-open"
    | "odds-unauthored";
  sectionId: number;
  message: string;
}

/** The pre-lock reveal lead (#943): the live bracket opens 24h before a stage locks. */
export const REVEAL_LEAD_MS = 24 * 60 * 60_000;

/**
 * How long after our committed lock Valve may still show a stage open before
 * the autopilot flags it. Valve flips `picks_allowed` at the first match, and the
 * layout is re-read every tick, so a lag beyond this means our time is wrong.
 */
export const VALVE_LOCK_SLACK_MS = 45 * 60_000;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Has this section locked, by our clock or by Valve's? */
export function isLocked(s: SectionSnapshot, nowMs: number): boolean {
  const lock = ms(s.lockAt);
  return s.valveOpen === false || (lock !== null && nowMs >= lock);
}

/** The phase of one section at `nowMs`. */
export function sectionPhase(s: SectionSnapshot, nowMs: number): SectionPhase {
  if (s.slots > 0 && s.resolved >= s.slots) return "decided";
  if (isLocked(s, nowMs)) return "live";
  const lock = ms(s.lockAt);
  if (lock === null) return "dark";
  return nowMs >= lock - REVEAL_LEAD_MS ? "revealed" : "scheduled";
}

/**
 * The config gaps and drifts a human must look at, most urgent first.
 *
 * `sections` must be in play order (Stage I … Grand Final). The rules:
 *
 *  - undated-stage-next (needs-human): a Swiss stage, or the playoffs, has no
 *    lock time while the stage before it is already live or decided. This is
 *    the moment the old weekly watcher existed for, and it is urgent: the stage
 *    can start within days and it will get no countdown, no reveal and no
 *    reminder until its time is committed. The playoffs count as one unit,
 *    keyed on their first section.
 *  - undated-stage (info): the same gap while the previous stage has not
 *    locked yet — expected, and nothing to do until the time is published.
 *  - no-source-before-reveal (needs-human): a dated Swiss stage within its 24h
 *    reveal lead (or later) with no HLTV source, so no live standings and no
 *    Swiss scoring bridge.
 *  - valve-closed-early (warn): Valve closed the stage while our lock is still
 *    in the future. Valve wins (picks freeze anyway); the committed time is wrong.
 *  - valve-still-open (warn): our lock passed more than VALVE_LOCK_SLACK_MS ago
 *    but Valve still accepts picks. HOTLINE has frozen picks Valve would take.
 *  - odds-unauthored (info): the playoff bracket is fully seeded and no
 *    Polymarket matchup is authored, so the Spotlight odds stay "coming soon".
 */
export function autopilotFindings(input: {
  sections: readonly SectionSnapshot[];
  nowMs: number;
  marketsAuthored: number;
}): AutopilotFinding[] {
  const { sections, nowMs } = input;
  const out: AutopilotFinding[] = [];

  // Play units: each Swiss stage alone, the playoff sections as one.
  const units: SectionSnapshot[][] = [];
  for (const s of sections) {
    const last = units[units.length - 1];
    if (s.kind === "playoff" && last && last[0].kind === "playoff") last.push(s);
    else units.push([s]);
  }

  units.forEach((unit, i) => {
    const head = unit[0];
    const label = head.kind === "playoff" ? "Playoffs" : head.name;
    const prev = i > 0 ? units[i - 1] : null;
    const prevUnderway = prev !== null && prev.every((p) => isLocked(p, nowMs) || sectionPhase(p, nowMs) === "decided");
    const undated = head.kind === "playoff" ? unit.every((s) => s.lockAt === null) : head.lockAt === null;

    if (undated && !unit.every((s) => sectionPhase(s, nowMs) === "decided")) {
      if (prevUnderway) {
        out.push({
          level: "needs-human",
          code: "undated-stage-next",
          sectionId: head.sectionId,
          message:
            `${label} has no published start time and ${prev![0].kind === "playoff" ? "the playoffs" : prev![0].name} is already underway. ` +
            (head.kind === "playoff"
              ? `Commit the per-game times to playoffSchedule (sections ${unit.map((s) => s.sectionId).join("/")}) in events-core.ts.`
              : `Commit lockSchedule + matchWindows for section ${head.sectionId} (and its HLTV source) in events-core.ts.`) +
            ` Valve will still lock it on time; until then it has no countdown, reveal or reminder.`,
        });
      } else {
        out.push({
          level: "info",
          code: "undated-stage",
          sectionId: head.sectionId,
          message: `${label} is dark until its start time is published (no action yet).`,
        });
      }
    }

    if (head.kind === "swiss") {
      const lock = ms(head.lockAt);
      if (lock !== null && !head.hasSource && nowMs >= lock - REVEAL_LEAD_MS && sectionPhase(head, nowMs) !== "decided") {
        out.push({
          level: "needs-human",
          code: "no-source-before-reveal",
          sectionId: head.sectionId,
          message: `${head.name} is inside its reveal window with no HLTV source: no live standings and no Swiss scoring until sectionSources[${head.sectionId}] is committed.`,
        });
      }
    }

    // Lock drift against Valve. The playoffs lock as one bracket at the first
    // quarterfinal, so they are judged on the unit's earliest lock, against the
    // first section's live flag; later rounds' per-game times are not lock times.
    const unitLocks = unit.map((s) => ms(s.lockAt)).filter((t): t is number => t !== null);
    const unitLock = unitLocks.length > 0 ? Math.min(...unitLocks) : null;
    const unitLockIso = unitLock !== null ? new Date(unitLock).toISOString() : null;
    if (unitLock !== null && head.valveOpen === false && nowMs < unitLock && sectionPhase(head, nowMs) !== "decided") {
      out.push({
        level: "warn",
        code: "valve-closed-early",
        sectionId: head.sectionId,
        message: `Valve closed ${label} before the committed lock (${unitLockIso}). Picks are frozen anyway; correct the committed time.`,
      });
    }
    if (unitLock !== null && head.valveOpen === true && nowMs >= unitLock + VALVE_LOCK_SLACK_MS) {
      out.push({
        level: "warn",
        code: "valve-still-open",
        sectionId: head.sectionId,
        message: `${label} locked on HOTLINE at ${unitLockIso} but Valve still accepts picks. Check the committed time against the real first match.`,
      });
    }

    if (head.kind === "playoff" && input.marketsAuthored === 0) {
      const seeded = unit[0].seeded;
      if (unit[0].teamSlots > 0 && seeded >= unit[0].teamSlots && sectionPhase(unit[0], nowMs) !== "decided") {
        out.push({
          level: "info",
          code: "odds-unauthored",
          sectionId: head.sectionId,
          message: "The quarterfinals are seeded and no Polymarket matchup is authored; Spotlight odds stay \"coming soon\" (optional).",
        });
      }
    }
  });

  const rank: Record<FindingLevel, number> = { "needs-human": 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/**
 * Re-alert policy: a finding alerts when first seen and again every
 * `ALERT_REPEAT_MS` while it persists; info never alerts. Pure so the dedupe is
 * provable; the caller owns the `lastAlerted` map (per process).
 */
export const ALERT_REPEAT_MS = 12 * 60 * 60_000;

export function findingKey(f: AutopilotFinding): string {
  return `${f.code}:${f.sectionId}`;
}

export function findingsToAlert(
  findings: readonly AutopilotFinding[],
  lastAlerted: ReadonlyMap<string, number>,
  nowMs: number,
): AutopilotFinding[] {
  return findings.filter((f) => {
    if (f.level === "info") return false;
    const last = lastAlerted.get(findingKey(f));
    return last === undefined || nowMs - last >= ALERT_REPEAT_MS;
  });
}
