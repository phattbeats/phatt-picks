/**
 * PHATT ID progression for Hotline (PHA-4477) — the pure half.
 *
 * Hotline feeds the ONE arcade-wide PHATT ID level (1–50) designed in PHA-4239:
 * XP is earned on days, capped at 80 a day and 300 a week, and the curve is
 * `40 + 2 × (L−1)` XP per level. Everything here is DERIVED from Hotline's own
 * facts (picks, outcomes, rank snapshots, seals, reactions), the same way coins
 * are, so Cologne backfills itself and a re-run always lands on the same answer.
 * Nothing is stored except the player's cosmetic choices (Player.loadout).
 *
 * Founding rules (PHA-4239 §2): points, rank, coin tier and correct picks are
 * never XP. Outcomes earn achievements (25 XP each, once, outside the caps) and
 * coins. Rewards are cosmetic only: felt colours by level, banner photos by
 * achievement, trinket pins.
 *
 * Brandon, 2026-10-24: the level number itself stays hidden on Hotline until
 * PHATT ID sign-in is live — it is computed (felts unlock from it) but not shown.
 *
 * A "stage" is what the site calls a stage: each Swiss stage, and the Playoffs as
 * ONE stage (the bracket locks together at the first quarter-final, #1245).
 */

// ── XP curve (PHA-4239 §3) ───────────────────────────────────────────────────

export const MAX_LEVEL = 50;
export const DAILY_CAP = 80;
export const WEEKLY_CAP = 300;

/** Cumulative XP needed to reach `level`: (L−1)² + 39 × (L−1). */
export function xpForLevel(level: number): number {
  const n = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)) - 1);
  return n * n + 39 * n;
}

/** The level a lifetime XP total reaches (1..50). */
export function levelForXp(xp: number): number {
  if (!(xp > 0)) return 1;
  return Math.min(MAX_LEVEL, 1 + Math.floor((Math.sqrt(1521 + 4 * xp) - 39) / 2));
}

// ── XP sources (PHA-4477 §2) ─────────────────────────────────────────────────

export const XP = {
  showingUp: 20,
  stageEntered: 12,
  majorFinished: 50,
  achievement: 25,
} as const;

/** "Game played" diminishing chain inside one day: 12, 7, 4, 3, 2, 1, 1, 0… */
export function gamePlayedXp(nthToday: number): number {
  return Math.round(XP.stageEntered * Math.pow(0.6, nthToday));
}

export type XpSource = "showing_up" | "stage_entered" | "major_finished" | "achievement";

/** Something the player did, at an instant. Capped sources are bucketed by day. */
export interface Activity {
  atMs: number;
  /** "stage" = a stage entered (showing up + game played); "visit" = showing up only. */
  kind: "stage" | "visit";
}

export interface LedgerRow {
  day: string;
  source: XpSource;
  raw: number;
  credited: number;
  cappedBy: "day" | "week" | null;
  atMs: number;
}

/** Arcade fallback timezone (arcade rules.js localDay); Hotline stores none per player. */
export const LEDGER_TZ = "America/New_York";

export function localDay(atMs: number, tz: string = LEDGER_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(atMs),
  );
}

/** ISO week id ("2026-W25") of a YYYY-MM-DD day — Mon–Sun, as the arcade does. */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const wk = 1 + Math.round(((d.getTime() - jan4.getTime()) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${wk}`;
}

/**
 * The XP ledger: capped sources (showing up, stages entered) credited day by
 * day under the 80/day and 300/week caps, plus the uncapped ones (Major
 * finished, achievements). Chronological, deterministic.
 */
export function buildLedger(
  activities: readonly Activity[],
  uncapped: readonly { atMs: number; source: "major_finished" | "achievement" }[],
): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const sorted = [...activities].sort((a, b) => a.atMs - b.atMs);
  const dayTotal = new Map<string, number>();
  const weekTotal = new Map<string, number>();
  const shownUp = new Set<string>();
  const gamesToday = new Map<string, number>();

  const credit = (day: string, source: XpSource, raw: number, atMs: number) => {
    const week = isoWeek(day);
    const roomDay = DAILY_CAP - (dayTotal.get(day) ?? 0);
    const roomWeek = WEEKLY_CAP - (weekTotal.get(week) ?? 0);
    const credited = Math.max(0, Math.min(raw, roomDay, roomWeek));
    const cappedBy = credited < raw ? (roomDay <= roomWeek ? "day" : "week") : null;
    dayTotal.set(day, (dayTotal.get(day) ?? 0) + credited);
    weekTotal.set(week, (weekTotal.get(week) ?? 0) + credited);
    rows.push({ day, source, raw, credited, cappedBy, atMs });
  };

  for (const a of sorted) {
    const day = localDay(a.atMs);
    if (!shownUp.has(day)) {
      shownUp.add(day);
      credit(day, "showing_up", XP.showingUp, a.atMs);
    }
    if (a.kind === "stage") {
      const n = gamesToday.get(day) ?? 0;
      gamesToday.set(day, n + 1);
      credit(day, "stage_entered", gamePlayedXp(n), a.atMs);
    }
  }
  for (const u of uncapped) {
    const raw = u.source === "major_finished" ? XP.majorFinished : XP.achievement;
    rows.push({ day: localDay(u.atMs), source: u.source, raw, credited: raw, cappedBy: null, atMs: u.atMs });
  }
  return rows.sort((a, b) => a.atMs - b.atMs || a.source.localeCompare(b.source));
}

export function ledgerTotal(rows: readonly LedgerRow[]): number {
  return rows.reduce((n, r) => n + r.credited, 0);
}

// ── Achievements (PHA-4477 §3, all 12 picked by Brandon) ────────────────────

export type AchievementKey =
  | "first_call"
  | "full_card"
  | "synced"
  | "stage_topper"
  | "clean_sweep"
  | "called_it"
  | "climber"
  | "bleachers"
  | "show_your_hand"
  | "poker_face"
  | "veteran"
  | "perfect_swiss";

export interface AchievementDef {
  key: AchievementKey;
  name: string;
  description: string;
  /** The trinket this achievement drops (PHA-4103) — shown as an enamel pin. */
  trinket: string;
  /** The HLTV banner photo it unlocks for the profile hero. */
  banner: string;
  bannerLabel: string;
}

const photo = (name: string) => `/photos/${name}.jpg`;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { key: "first_call", name: "First Call", description: "Save a full set of picks for a stage.", trinket: "Rotary handset", banner: photo("crowd-march"), bannerLabel: "The fan march" },
  { key: "full_card", name: "Full Card", description: "Make picks in every stage of one Major.", trinket: "Punched ticket", banner: photo("arena-gold"), bannerLabel: "The arena in gold" },
  { key: "synced", name: "Locked In", description: "Push your picks to Valve with Lock in & sync.", trinket: "Padlock", banner: photo("arena-blue"), bannerLabel: "The arena in blue" },
  { key: "stage_topper", name: "Top of the Stage", description: "Score the most points on a stage (ties count).", trinket: "Laurel", banner: photo("emotion-fist"), bannerLabel: "The fist pump" },
  { key: "clean_sweep", name: "Clean Sweep", description: "Call all four quarter-finals right.", trinket: "Broom", banner: photo("arena-stage"), bannerLabel: "The Grand Final stage" },
  { key: "called_it", name: "Called It", description: "Pick the Major champion.", trinket: "Crown", banner: photo("energy-trophy-lift"), bannerLabel: "The trophy lift" },
  { key: "climber", name: "Climber", description: "Move up two or more places on the leaderboard in one stage.", trinket: "Arrow", banner: photo("energy-sparkler-walk"), bannerLabel: "The sparkler walk" },
  { key: "bleachers", name: "From the Bleachers", description: "React to 10 picks.", trinket: "Megaphone", banner: photo("crowd-red-smoke"), bannerLabel: "Red smoke in the stands" },
  { key: "show_your_hand", name: "Show Your Hand", description: "Seal a stage Public before it locks.", trinket: "Open eye", banner: photo("crowd-sign"), bannerLabel: "The hand-made sign" },
  { key: "poker_face", name: "Poker Face", description: "Seal a stage Hidden, then top that stage.", trinket: "Mask", banner: photo("emotion-breath"), bannerLabel: "The deep breath" },
  { key: "veteran", name: "Veteran", description: "Play two Majors.", trinket: "Twin stars", banner: photo("arena-walk"), bannerLabel: "The walkout aisle" },
  { key: "perfect_swiss", name: "Perfect Swiss", description: "Call every 3-0 and 0-3 right in one Swiss stage.", trinket: "Diamond", banner: photo("energy-confetti"), bannerLabel: "The confetti" },
];

export const ACHIEVEMENT_BY_KEY: ReadonlyMap<AchievementKey, AchievementDef> = new Map(
  ACHIEVEMENTS.map((a) => [a.key, a] as const),
);

/** One stage of one Major, as this player played it. */
export interface StageFact {
  /** Representative id: the Swiss section id, or the first playoff section id. */
  stageId: number;
  isPlayoffs: boolean;
  /** Every slot in the stage has a team picked. */
  full: boolean;
  /** When the stage locked (null = no schedule; then `resolvedAtMs` stands in). */
  lockAtMs: number | null;
  /** When the stage's last result landed — only set once EVERY slot has resolved. */
  resolvedAtMs: number | null;
  /** This player's points on the stage, and the field's best (null until resolved). */
  points: number;
  topPoints: number | null;
  /** Leaderboard rank after this stage and after the previous one (null if unknown). */
  rankAfter: number | null;
  rankBefore: number | null;
  /** Swiss: the 3-0 and 0-3 buckets both called exactly right (resolved stages only). */
  perfectSwiss: boolean;
  /** Playoffs: every quarter-final right / the Grand Final right (null until resolved). */
  allQuarterFinals: boolean | null;
  quarterFinalsAtMs: number | null;
  champion: boolean | null;
  championAtMs: number | null;
  /** The player's seal on this stage, if any (initial choice). */
  seal: { visibility: "public" | "hidden"; lockedAtMs: number } | null;
}

export interface MajorFact {
  eventId: number;
  slug: string;
  stages: StageFact[];
  /** The coin-mint instant (Grand Final resolved) — null while the Major is live. */
  finishedAtMs: number | null;
  /** The player has a coin from this Major (took part, it concluded). */
  finished: boolean;
}

export interface PlayerFacts {
  majors: MajorFact[];
  /** First time any of their picks was confirmed written to Valve. */
  syncedAtMs: number | null;
  /** When they sent each reaction (Bleachers). */
  reactionsSentAtMs: number[];
  nowMs: number;
}

export interface Unlock {
  key: AchievementKey;
  atMs: number;
  /** The Major it was earned in, when it belongs to one. */
  eventId: number | null;
}

/** A stage counts as "entered" once it has locked with a full set of picks. */
export function stageEnteredAtMs(s: StageFact, nowMs: number): number | null {
  if (!s.full) return null;
  const at = s.lockAtMs ?? s.resolvedAtMs;
  if (at === null || at > nowMs) return null;
  return at;
}

function isTopper(s: StageFact): boolean {
  return s.resolvedAtMs !== null && s.topPoints !== null && s.topPoints > 0 && s.points === s.topPoints;
}

/** Every achievement the facts prove, each at the earliest instant it was earned. */
export function evaluateAchievements(f: PlayerFacts): Unlock[] {
  const best = new Map<AchievementKey, Unlock>();
  const earn = (key: AchievementKey, atMs: number | null, eventId: number | null) => {
    if (atMs === null || !Number.isFinite(atMs) || atMs > f.nowMs) return;
    const cur = best.get(key);
    if (!cur || atMs < cur.atMs) best.set(key, { key, atMs, eventId });
  };

  const majorsEntered: { eventId: number; atMs: number }[] = [];
  for (const m of f.majors) {
    const entered = m.stages.map((s) => stageEnteredAtMs(s, f.nowMs));
    const firstEntered = entered.filter((x): x is number => x !== null).sort((a, b) => a - b)[0];
    if (firstEntered !== undefined) majorsEntered.push({ eventId: m.eventId, atMs: firstEntered });

    m.stages.forEach((s, i) => {
      earn("first_call", entered[i], m.eventId);
      if (isTopper(s)) earn("stage_topper", s.resolvedAtMs, m.eventId);
      if (s.perfectSwiss) earn("perfect_swiss", s.resolvedAtMs, m.eventId);
      if (s.allQuarterFinals) earn("clean_sweep", s.quarterFinalsAtMs, m.eventId);
      if (s.champion) earn("called_it", s.championAtMs, m.eventId);
      if (s.resolvedAtMs !== null && s.rankBefore !== null && s.rankAfter !== null && s.rankBefore - s.rankAfter >= 2) {
        earn("climber", s.resolvedAtMs, m.eventId);
      }
      if (s.seal?.visibility === "public") earn("show_your_hand", s.seal.lockedAtMs, m.eventId);
      if (s.seal?.visibility === "hidden" && isTopper(s)) earn("poker_face", s.resolvedAtMs, m.eventId);
    });

    if (m.stages.length > 0 && entered.every((x) => x !== null)) {
      earn("full_card", Math.max(...(entered as number[])), m.eventId);
    }
  }

  if (majorsEntered.length >= 2) {
    const second = [...majorsEntered].sort((a, b) => a.atMs - b.atMs)[1];
    earn("veteran", second.atMs, second.eventId);
  }
  earn("synced", f.syncedAtMs, null);
  const reactions = [...f.reactionsSentAtMs].sort((a, b) => a - b);
  if (reactions.length >= 10) earn("bleachers", reactions[9], null);

  // Registry order, so the wall and the pins always read the same way.
  return ACHIEVEMENTS.map((a) => best.get(a.key)).filter((u): u is Unlock => !!u);
}

/** The XP ledger for a player's facts and unlocks. */
export function ledgerFor(f: PlayerFacts, unlocks: readonly Unlock[]): LedgerRow[] {
  const activities: Activity[] = [];
  for (const m of f.majors) {
    for (const s of m.stages) {
      const at = stageEnteredAtMs(s, f.nowMs);
      if (at !== null) activities.push({ atMs: at, kind: "stage" });
      if (s.seal && s.seal.lockedAtMs <= f.nowMs) activities.push({ atMs: s.seal.lockedAtMs, kind: "visit" });
    }
  }
  for (const r of f.reactionsSentAtMs) if (r <= f.nowMs) activities.push({ atMs: r, kind: "visit" });

  const uncapped: { atMs: number; source: "major_finished" | "achievement" }[] = [];
  for (const m of f.majors) {
    if (m.finished && m.finishedAtMs !== null && m.finishedAtMs <= f.nowMs) {
      uncapped.push({ atMs: m.finishedAtMs, source: "major_finished" });
    }
  }
  for (const u of unlocks) uncapped.push({ atMs: u.atMs, source: "achievement" });
  return buildLedger(activities, uncapped);
}

// ── Unlockables (cosmetic only) ──────────────────────────────────────────────

export type FeltKey = "navy" | "oxblood" | "forest" | "velvet" | "royal" | "gold";

export interface FeltDef {
  key: FeltKey;
  name: string;
  /** The PHATT ID level it unlocks at (the title levels). Never shown as a number until sign-in is live. */
  level: number;
  /** Rendered tile under public/coins/ (recoloured from the navy Blender render). */
  tile: string;
  /** The CSS bed colour behind the tiles. */
  bed: string;
}

export const FELTS: readonly FeltDef[] = [
  { key: "navy", name: "Navy", level: 1, tile: "/coins/felt-slot.webp", bed: "#0a1626" },
  { key: "oxblood", name: "Oxblood", level: 10, tile: "/coins/felt-oxblood.webp", bed: "#1e0a0d" },
  { key: "forest", name: "Forest", level: 20, tile: "/coins/felt-forest.webp", bed: "#0a1a12" },
  { key: "velvet", name: "Black velvet", level: 30, tile: "/coins/felt-velvet.webp", bed: "#0b0b0d" },
  { key: "royal", name: "Royal purple", level: 40, tile: "/coins/felt-royal.webp", bed: "#160c24" },
  { key: "gold", name: "Gold-trim black", level: 50, tile: "/coins/felt-gold.webp", bed: "#0d0b08" },
];

export function feltByKey(key: string | null | undefined): FeltDef {
  return FELTS.find((f) => f.key === key) ?? FELTS[0];
}

export interface Loadout {
  felt: FeltKey | null;
  /** The achievement whose banner photo is on the profile hero (null = the default rotation). */
  banner: AchievementKey | null;
}

export const EMPTY_LOADOUT: Loadout = { felt: null, banner: null };

export function parseLoadout(json: string | null | undefined): Loadout {
  if (!json) return EMPTY_LOADOUT;
  try {
    const raw = JSON.parse(json) as Partial<Record<keyof Loadout, unknown>>;
    const felt = FELTS.some((f) => f.key === raw.felt) ? (raw.felt as FeltKey) : null;
    const banner = ACHIEVEMENT_BY_KEY.has(raw.banner as AchievementKey) ? (raw.banner as AchievementKey) : null;
    return { felt, banner };
  } catch {
    return EMPTY_LOADOUT;
  }
}

/**
 * The loadout as it may actually be worn: a felt above the player's level or a
 * banner from an achievement they don't hold falls back to the default, so a
 * stale choice (e.g. after a delete-means-start-over) can never show.
 */
export function effectiveLoadout(l: Loadout, level: number, unlocked: ReadonlySet<AchievementKey>): Loadout {
  const felt = l.felt && feltByKey(l.felt).level <= level ? l.felt : null;
  const banner = l.banner && unlocked.has(l.banner) ? l.banner : null;
  return { felt, banner };
}

// ── PHATT ID items (Phase 2/3 contract) ──────────────────────────────────────

/** A struck challenge coin as a PHATT ID inventory item. */
export function coinItemKey(slug: string, tier: string): string {
  return `hotline/coin.${slug}.${tier}`;
}

/** An achievement's trinket as a PHATT ID inventory item. */
export function trinketItemKey(key: AchievementKey): string {
  return `hotline/trinket.${key}`;
}
