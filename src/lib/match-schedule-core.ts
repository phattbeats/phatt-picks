/**
 * Match schedule (PHA-5538) — the pure rules behind the "Matches" list on a
 * Swiss stage and the start-time chip on each playoff slot.
 *
 * Brandon: "during the stages and playoffs, add the future matches and times.
 * so you can see the finished matches and the scheduled ones for the next day."
 *
 * The data already exists: every Swiss bracket cell HLTV renders carries its
 * start instant (the group table's `data-unix`, parsed in swiss-bracket-core),
 * played or not, and the hourly standings crawl refreshes it. This module only
 * shapes it:
 *
 *   1. flattenSwissSchedule — every match cell of the contention columns, in
 *      kick-off order, with its Swiss round number (1 + wins + losses of the
 *      record column it sits in).
 *   2. groupByLocalDay — buckets by the VIEWER's calendar day (an IANA zone, or
 *      the runtime's own when omitted), labelled today / tomorrow / yesterday.
 *      A match with no published time goes in a trailing "TBA" bucket: we never
 *      invent a time.
 *   3. matchState — final / live / upcoming / tba.
 *
 * Spoiler-free (PHA-5495) note: a Swiss pairing after round 1 reveals both
 * teams' records, so the UI masks pairings where `spoilsRecords` is true.
 * Round 1 (the 0:0 column) is drawn before the stage starts and spoils nothing.
 *
 * Pure leaf: no `@/`, no React, no fetch — the verify script loads it under node.
 */

/** One side of a scheduled/finished match. `name` null = slot not filled yet. */
export interface SchedSideInput {
  name: string | null;
  pickid: number | null;
  score: number | null;
  winner: boolean;
}

export interface SchedMatchInput<S extends SchedSideInput = SchedSideInput> {
  matchId: number | null;
  team1: S;
  team2: S;
  bestOf: number;
  played: boolean;
  startTimeMs: number | null;
}

export interface SchedRoundInput<S extends SchedSideInput = SchedSideInput> {
  label: string;
  kind: "advancing" | "eliminated" | "contention";
  matches: readonly SchedMatchInput<S>[];
}

export interface SchedMatch<S extends SchedSideInput = SchedSideInput> {
  key: string;
  /** The record column, e.g. "2:0". Reveals records — masked under spoiler-free. */
  record: string;
  /** Swiss round number: 1 + wins + losses of the record column (0:0 → 1). */
  round: number;
  bestOf: number;
  played: boolean;
  startTimeMs: number | null;
  team1: S;
  team2: S;
  /** True when showing this pairing would reveal earlier results (round > 1). */
  spoilsRecords: boolean;
}

/** "2:1" → 4; an unparseable label → null. */
export function swissRoundNumber(label: string): number | null {
  const m = label.match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return null;
  return 1 + Number(m[1]) + Number(m[2]);
}

/**
 * Every match of the contention columns, in kick-off order. Ties (two matches
 * at the same instant) keep round, then source order. Matches with no time
 * sort last. Terminal columns (3:x / x:3) hold settled teams, not matches.
 */
export function flattenSwissSchedule<S extends SchedSideInput>(
  rounds: readonly SchedRoundInput<S>[],
): SchedMatch<S>[] {
  const out: SchedMatch<S>[] = [];
  for (const r of rounds) {
    if (r.kind !== "contention") continue;
    const round = swissRoundNumber(r.label) ?? 0;
    r.matches.forEach((m, i) => {
      out.push({
        key: m.matchId != null ? `m${m.matchId}` : `${r.label}#${i}`,
        record: r.label,
        round,
        bestOf: m.bestOf,
        played: m.played,
        startTimeMs: typeof m.startTimeMs === "number" && Number.isFinite(m.startTimeMs) ? m.startTimeMs : null,
        team1: m.team1,
        team2: m.team2,
        spoilsRecords: round !== 1,
      });
    });
  }
  // Array.prototype.sort is stable, so equal keys keep source order.
  return out.sort((a, b) => {
    const ta = a.startTimeMs ?? Number.POSITIVE_INFINITY;
    const tb = b.startTimeMs ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.round - b.round;
  });
}

/** The calendar day of `ms` in `timeZone` (viewer's own when omitted): "YYYY-MM-DD". */
export function localDayKey(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Shift a "YYYY-MM-DD" key by whole calendar days (zone-free date math). */
export function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export type RelativeDay = "today" | "tomorrow" | "yesterday" | null;

export function relativeDay(key: string, todayKey: string): RelativeDay {
  if (key === todayKey) return "today";
  if (key === shiftDayKey(todayKey, 1)) return "tomorrow";
  if (key === shiftDayKey(todayKey, -1)) return "yesterday";
  return null;
}

export interface DayGroup<M> {
  /** "YYYY-MM-DD", or "tba" for matches without a published time. */
  key: string;
  rel: RelativeDay;
  /** The day is before today: every match on it is history. */
  past: boolean;
  matches: M[];
}

/**
 * Bucket matches by the viewer's calendar day, in order; "tba" last. Input
 * order is kept inside a bucket (flattenSwissSchedule already sorts).
 */
export function groupByLocalDay<M extends { startTimeMs: number | null }>(
  matches: readonly M[],
  nowMs: number,
  timeZone?: string,
): DayGroup<M>[] {
  const todayKey = localDayKey(nowMs, timeZone);
  const byKey = new Map<string, M[]>();
  const tba: M[] = [];
  for (const m of matches) {
    if (m.startTimeMs == null) {
      tba.push(m);
      continue;
    }
    const k = localDayKey(m.startTimeMs, timeZone);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(m);
  }
  const groups: DayGroup<M>[] = [...byKey.keys()]
    .sort()
    .map((k) => ({ key: k, rel: relativeDay(k, todayKey), past: k < todayKey, matches: byKey.get(k)! }));
  if (tba.length > 0) groups.push({ key: "tba", rel: null, past: false, matches: tba });
  return groups;
}

export type MatchState = "final" | "live" | "upcoming" | "tba";

/**
 * Final once the source has a result; live once its start has passed without
 * one (HLTV moves a postponed match's time, so a stale "live" heals on the next
 * crawl); upcoming with a time; tba without one.
 */
export function matchState(m: { played: boolean; startTimeMs: number | null }, nowMs: number): MatchState {
  if (m.played) return "final";
  if (m.startTimeMs == null) return "tba";
  return m.startTimeMs <= nowMs ? "live" : "upcoming";
}
