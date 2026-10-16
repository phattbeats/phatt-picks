/**
 * Coach marks ("blue bubbles") — the pure half: the tip registry, who sees
 * what, persistence shape, and which tip goes next. No DOM / React here so the
 * rules are unit-tested by scripts/verify-coach.ts.
 *
 * Two audiences:
 *   - "new"       first-time players: a short how-Pick'Em-works tour.
 *   - "returning" players from before the Singapore redesign: NEW bubbles on
 *                 what moved / what's new.
 *   - "all"       both.
 * A device decides its audience ONCE (first visit after this ships) and keeps
 * it, so nobody flips from the NEW tour into the beginner tour mid-week.
 *
 * Persistence is localStorage only (no DB schema): key TIPS_STORAGE_KEY holds
 * { v, aud, seen[], off }. "Turn off tips" sets off; Settings → Reset tips
 * clears seen + off.
 */

export type CoachAudience = "new" | "returning";
export type TipAudience = CoachAudience | "all";
export type TipPlacement = "auto" | "top" | "bottom";

export interface CoachTip {
  /** Stable id — persisted in `seen`, never reuse for different copy. */
  id: string;
  /** `data-tip` value of the element the bubble points at. */
  anchor: string;
  audience: TipAudience;
  /**
   * Route patterns: "/" exact, "/picks/*" = "/picks" and below,
   * "@self" = the viewer's own profile (/players/<selfId>), "*" = everywhere.
   */
  routes: readonly string[];
  /** Pill text (top-left). */
  label: string;
  title: string;
  /** One line per entry; keep each ≤ ~60 chars. */
  body: readonly string[];
  placement?: TipPlacement;
}

export const TIPS_STORAGE_KEY = "hl_tips_v2";

/**
 * The Singapore redesign went live on 2026-10-11 — an account created before
 * then knows the old layout, so it gets the "what changed" tips.
 */
export const REDESIGN_CUTOFF_MS = Date.UTC(2026, 9, 11);

/**
 * localStorage keys the pre-redesign app wrote. Any of these on a device that
 * has no TIPS_STORAGE_KEY yet means "been here before" → returning.
 */
export const LEGACY_VISIT_KEYS: readonly string[] = ["hotline:howto-seen:v1", "hl-intro-seen"];
export const LEGACY_VISIT_PREFIX = "hotline:";

/**
 * Registry — ORDER MATTERS: within a page, the earliest eligible tip whose
 * anchor is on screen shows first; the next appears after it's dismissed.
 */
export const COACH_TIPS: readonly CoachTip[] = [
  // ── first-time tour: how Pick'Em works ────────────────────────────────
  {
    id: "tour-path",
    anchor: "home-path",
    audience: "new",
    routes: ["/"],
    label: "How it works",
    title: "The road to the trophy",
    body: ["Three Swiss stages, then the playoffs.", "Each stage opens for picks and locks at its first match."],
  },
  {
    id: "tour-bell",
    anchor: "nav-bell",
    audience: "new",
    routes: ["*"],
    label: "Tip",
    title: "Your hotline",
    body: ["Locks, results and reactions to your calls land here.", "We ping, you pick."],
  },
  {
    id: "tour-buckets",
    anchor: "picks-buckets",
    audience: "new",
    routes: ["/picks/*"],
    label: "How it works",
    title: "Ten calls, three buckets",
    body: ["3–0: goes unbeaten. Two of these.", "Advance: gets out at 3–1 or 3–2. Six.", "0–3: wins nothing. Two. Brutal."],
  },
  {
    id: "tour-dossier",
    anchor: "picks-dossier",
    audience: "new",
    routes: ["/picks/*"],
    label: "Tip",
    title: "Do your homework",
    body: ["Tap i on any team for its dossier:", "ranking, form and standings before you commit."],
  },
  {
    id: "tour-compare",
    anchor: "lb-compare",
    audience: "new",
    routes: ["/leaderboard"],
    label: "Tip",
    title: "Go head to head",
    body: ["Line your picks up against anyone's.", "The calls you nailed and they didn't go first."],
  },
  {
    id: "tour-coins",
    anchor: "profile-coins",
    audience: "new",
    routes: ["@self"],
    label: "Tip",
    title: "Your coin case",
    body: ["Play a Major, strike its coin.", "Finish top 10% and it comes out diamond."],
  },

  // ── returning players: what changed in the redesign ─────────────────────
  {
    id: "new-look",
    anchor: "nav-lockup",
    audience: "returning",
    routes: ["/"],
    label: "New",
    title: "Fresh coat for Singapore",
    body: ["Same game, cleaner board.", "Everything you used is still here, just easier to find."],
  },
  {
    id: "new-inbox",
    anchor: "nav-bell",
    audience: "returning",
    routes: ["*"],
    label: "New",
    title: "One inbox for everything",
    body: ["Locks, results and reactions stack up here.", "Unread ones get a badge."],
  },
  {
    id: "new-archive",
    anchor: "lb-archive",
    audience: "returning",
    routes: ["/leaderboard"],
    label: "New",
    title: "Last Major, one tap",
    body: ["Past final standings live right here now.", "Relive it, or settle an argument."],
  },
  {
    id: "new-teams",
    anchor: "team-link",
    audience: "returning",
    routes: ["*"],
    label: "New",
    title: "Teams get their own pages",
    body: ["Tap a team name for its full page:", "roster, results and road so far."],
  },
  {
    id: "new-settings",
    anchor: "profile-settings",
    audience: "returning",
    routes: ["@self"],
    label: "New",
    title: "Settings moved",
    body: ["Alerts, invites, devices and tips", "now live behind the gear."],
  },

  // ── everyone ───────────────────────────────────────────────────────────
  {
    id: "react",
    anchor: "react",
    audience: "all",
    routes: ["/leaderboard/compare", "/players/*"],
    label: "Tip",
    title: "Talk your trash",
    body: ["React to a rival's call with a stamp.", "It stays anonymous while the stage is live."],
  },
];

/** Persisted per device. */
export interface TipsState {
  v: 2;
  /** null until decided on first visit. */
  aud: CoachAudience | null;
  seen: string[];
  off: boolean;
}

export const EMPTY_TIPS_STATE: TipsState = { v: 2, aud: null, seen: [], off: false };

/** Tolerant parse — anything malformed reads as a fresh device. */
export function parseTipsState(raw: string | null | undefined): TipsState {
  if (!raw) return { ...EMPTY_TIPS_STATE, seen: [] };
  try {
    const o = JSON.parse(raw) as Partial<TipsState>;
    return {
      v: 2,
      aud: o.aud === "new" || o.aud === "returning" ? o.aud : null,
      seen: Array.isArray(o.seen) ? o.seen.filter((x): x is string => typeof x === "string") : [],
      off: o.off === true,
    };
  } catch {
    return { ...EMPTY_TIPS_STATE, seen: [] };
  }
}

export function serializeTipsState(s: TipsState): string {
  return JSON.stringify({ v: 2, aud: s.aud, seen: [...new Set(s.seen)], off: s.off });
}

/**
 * Decide a device's audience the first time it's seen.
 * Precedence: an already-decided audience sticks → an account created before
 * the redesign → any pre-redesign localStorage trace → otherwise new.
 */
export function resolveAudience(input: {
  stored: CoachAudience | null;
  accountCreatedAtMs: number | null;
  hasLegacyVisit: boolean;
}): CoachAudience {
  if (input.stored) return input.stored;
  if (input.accountCreatedAtMs !== null && input.accountCreatedAtMs < REDESIGN_CUTOFF_MS) return "returning";
  if (input.hasLegacyVisit) return "returning";
  return "new";
}

/** Does `pattern` match `path` (see CoachTip.routes)? */
export function routeMatches(pattern: string, path: string, selfId: string | null): boolean {
  const p = path.replace(/\/+$/, "") || "/";
  if (pattern === "*") return true;
  if (pattern === "@self") return !!selfId && p === `/players/${selfId}`;
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    return p === base || p.startsWith(`${base}/`);
  }
  return p === pattern;
}

export function audienceMatches(tip: TipAudience, aud: CoachAudience | null): boolean {
  return aud !== null && (tip === "all" || tip === aud);
}

/** Tips eligible on this page for this device, in registry order. */
export function tipsForPage(
  tips: readonly CoachTip[],
  ctx: { path: string; selfId: string | null; state: TipsState },
): CoachTip[] {
  if (ctx.state.off || ctx.state.aud === null) return [];
  const seen = new Set(ctx.state.seen);
  return tips.filter(
    (t) =>
      !seen.has(t.id) &&
      audienceMatches(t.audience, ctx.state.aud) &&
      t.routes.some((r) => routeMatches(r, ctx.path, ctx.selfId)),
  );
}

/**
 * The one tip to show: the first eligible tip (registry order) whose anchor is
 * currently on screen. `visibleAnchors` is the set of data-tip values present
 * and in the viewport. Returns null when nothing qualifies.
 */
export function nextTip(eligible: readonly CoachTip[], visibleAnchors: ReadonlySet<string>): CoachTip | null {
  return eligible.find((t) => visibleAnchors.has(t.anchor)) ?? null;
}

export function markSeen(s: TipsState, id: string): TipsState {
  return s.seen.includes(id) ? s : { ...s, seen: [...s.seen, id] };
}

/** Settings → Reset tips: every tip shows again; the audience is kept. */
export function resetTips(s: TipsState): TipsState {
  return { ...s, seen: [], off: false };
}

export type BubbleSide = "top" | "bottom";

/**
 * Position a bubble against its anchor inside the viewport. Prefers `want`
 * (auto = below when it fits, else above, else whichever side has more room),
 * centres on the anchor, clamps to the viewport with `margin`, and returns the
 * arrow's x offset inside the bubble (clamped off the rounded corners).
 * `topInset`/`bottomInset` reserve fixed chrome (sticky header, bottom nav).
 */
export function placeBubble(i: {
  anchor: { top: number; left: number; width: number; height: number };
  bubble: { width: number; height: number };
  viewport: { width: number; height: number };
  want?: TipPlacement;
  gap?: number;
  margin?: number;
  topInset?: number;
  bottomInset?: number;
}): { top: number; left: number; side: BubbleSide; arrowX: number } {
  const gap = i.gap ?? 12;
  const margin = i.margin ?? 12;
  const topInset = i.topInset ?? 0;
  const bottomInset = i.bottomInset ?? 0;
  const a = i.anchor;
  const b = i.bubble;
  const vw = i.viewport.width;
  const vh = i.viewport.height;

  const roomBelow = vh - bottomInset - (a.top + a.height) - gap - margin;
  const roomAbove = a.top - topInset - gap - margin;
  const fitsBelow = roomBelow >= b.height;
  const fitsAbove = roomAbove >= b.height;
  let side: BubbleSide;
  if (i.want === "top") side = fitsAbove || !fitsBelow ? "top" : "bottom";
  else if (i.want === "bottom") side = fitsBelow || !fitsAbove ? "bottom" : "top";
  else side = fitsBelow ? "bottom" : fitsAbove ? "top" : roomBelow >= roomAbove ? "bottom" : "top";

  const top = side === "bottom" ? a.top + a.height + gap : a.top - gap - b.height;
  const centre = a.left + a.width / 2;
  const maxLeft = Math.max(margin, vw - margin - b.width);
  const left = Math.min(Math.max(centre - b.width / 2, margin), maxLeft);
  const arrowX = Math.min(Math.max(centre - left, 18), Math.max(18, b.width - 18));
  return { top: Math.round(top), left: Math.round(left), side, arrowX: Math.round(arrowX) };
}
