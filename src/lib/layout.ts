/**
 * Layout parsing: read cologne-layout.json (or live Valve API response)
 * into typed structures. All points_per_pick values come from the API;
 * nothing is hardcoded here.
 */

import layoutFixture from "@/fixtures/cologne-layout.json";

export interface TeamSlot {
  pickid: number; // 0 = TBD
}

export interface PickSlot {
  index: number;
  pickids: number[];
}

export interface Group {
  groupid: number;
  name: string;
  points_per_pick: number; // source of truth — read from layout
  picks_allowed: boolean;
  teams: TeamSlot[];
  picks: PickSlot[];
}

export interface Section {
  sectionid: number;
  name: string;
  groups: Group[];
}

export interface TeamDef {
  pickid: number;
  logo: string; // slug used for logo lookup
  name: string;
}

export interface Layout {
  event: number;
  name: string;
  sections: Section[];
  teams: TeamDef[];
}

export interface LayoutEnvelope {
  result: Layout;
}

// Committed fixture — ingested once, not re-derived.
// The running app fetches live data during the event and merges it;
// the fixture is the schema-defining snapshot.
const COMMITTED: LayoutEnvelope = layoutFixture as LayoutEnvelope;

/**
 * The committed fixture — IEM Cologne 2026 (event 26), whatever event is being
 * served. Fine for Cologne's own archived views and for event-agnostic
 * structure, but NOT a statement about any other event's Pick'Em: a Major whose
 * layout Valve hasn't published has no sections or teams yet. For "what can be
 * picked for event N" read `committedLayoutFor(N)` or, server-side,
 * `getEffectiveLayout(N)` (layout-state), which return null until it opens.
 */
export function getCommittedLayout(): Layout {
  return COMMITTED.result;
}

/**
 * The committed fixture that describes `eventId`, or null when no fixture in
 * this build does (e.g. the next Major before its layout lands — the
 * pre-open state). Never substitutes another event's fixture.
 */
export function committedLayoutFor(eventId: number): Layout | null {
  return COMMITTED.result.event === eventId ? COMMITTED.result : null;
}

/** Build a pickid → TeamDef lookup from the layout. */
export function buildTeamMap(layout: Layout): Map<number, TeamDef> {
  const m = new Map<number, TeamDef>();
  for (const t of layout.teams) {
    m.set(t.pickid, t);
  }
  return m;
}

/** Build a groupid → Section lookup for fast access. */
export function buildSectionByGroup(layout: Layout): Map<number, Section> {
  const m = new Map<number, Section>();
  for (const s of layout.sections) {
    for (const g of s.groups) {
      m.set(g.groupid, s);
    }
  }
  return m;
}

// Pure layout-shape helpers (no fixture/bigint deps) live in ./layout-core
// so verify-picks-guard can import them under node without a bundler.
export { validatePickAgainstLayout } from "./layout-core";
