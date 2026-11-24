/**
 * Pre-event seeding for the Swiss simulator (PHA-5453).
 *
 * Valve's Major rulebook: "Coming into the event, all 32 teams are sorted based
 * on their current global standing in the VRS." This is that standing, copied
 * from Valve's own published file — not computed, not adjusted:
 *
 *   PGL Major Singapore 2026 → ValveSoftware/counter-strike_regional_standings
 *   invitation/2026/standings_global_2026_11_02.md
 *
 * Proof it is the snapshot Valve seeded from: sorted by these ranks, the 16
 * Stage I teams give seeds whose 1v9 … 8v16 match-ups equal all 8 real Stage I
 * opening matches HLTV published (checked 2026-11-24; the 2026-10-05 snapshot
 * does not). The same check picks 2026-05-04 for IEM Cologne 2026, which the
 * replay test (scripts/verify-swiss-sim.ts) runs through all three stages.
 *
 * `points` are the same file's VRS points, used only by vrs-odds-core (Valve's
 * own expected-win model). Keyed by layout pickid. Pure leaf, no imports.
 */

export interface PreEventSeeding {
  /** Human label + link for the source line under the board. */
  label: string;
  url: string;
  /** pickid → [global VRS rank, VRS points]. */
  teams: Readonly<Record<number, readonly [rank: number, points: number]>>;
}

const SINGAPORE_2026: PreEventSeeding = {
  label: "Valve VRS, 2 Nov 2026",
  url: "https://github.com/ValveSoftware/counter-strike_regional_standings/blob/main/invitation/2026/standings_global_2026_11_02.md",
  teams: {
    // Stage I
    1: [15, 1564], // Ninjas in Pyjamas
    153: [16, 1560], // PARIVISION
    95: [18, 1548], // HEROIC
    61: [20, 1539], // FaZe
    48: [21, 1528], // Liquid
    110: [22, 1513], // Eternal Fire
    78: [23, 1511], // 100 Thieves
    112: [24, 1490], // 9z
    140: [25, 1489], // M80
    151: [29, 1466], // DENDELE
    113: [35, 1406], // Imperial
    130: [38, 1391], // Wildcard
    150: [45, 1337], // GOSH (BC.Game roster: asap, Magisk, mzinho, s1mple, Senzu)
    132: [48, 1318], // FlyQuest
    138: [55, 1272], // Chinggis Warriors (cool4st, fury5k, ROUX, sk0R, tikuak)
    127: [56, 1267], // Lynn Vision
    // Stage II invites
    145: [8, 1721], // FUT
    107: [10, 1650], // Nemiga
    59: [11, 1616], // G2
    149: [12, 1598], // The One (1win roster: ArtFr0st, Ax1Le, BELCHONOKK, fame, nafany)
    12: [13, 1589], // Natus Vincere
    60: [14, 1572], // Astralis
    122: [17, 1554], // The MongolZ
    80: [19, 1546], // MIBR
    // Stage III invites
    106: [1, 1960], // MOUZ
    89: [2, 1922], // Vitality
    85: [3, 1912], // FURIA
    134: [4, 1860], // Aurora
    81: [5, 1842], // Spirit
    152: [6, 1786], // BETBOOM
    139: [7, 1764], // Falcons
    126: [9, 1662], // Legacy
  },
};

/** Keyed by Valve event id (the app's EVENT_ID; pgl-singapore-2026-layout.json `event`). */
const BY_EVENT: Readonly<Record<number, PreEventSeeding>> = {
  27: SINGAPORE_2026,
};

export function preEventSeeding(eventId: number): PreEventSeeding | null {
  return BY_EVENT[eventId] ?? null;
}
