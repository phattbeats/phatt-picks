/**
 * Team statistics & standings (PHA-893) — pure data + helpers, keyed by Valve
 * pickid so the standalone verify script (plain Node, no `@/` alias) and the
 * client drawer both load the same map. Rendering lives in TeamStatsDrawer.
 *
 * Three facets per team, mirroring the issue: world STANDING (HLTV world ranking),
 * ROSTER (active five), and the FIVE most recent official matches. Sourced from
 * HLTV (hltv.org) on the date below; this is a frozen snapshot, not a live feed.
 * Re-run `scripts/gather-team-stats.ts` to refresh recent results + hltvUrl at
 * each stage boundary (PHA-897; see docs/PRE-MAJOR-CHECKLIST.md). Teams with no
 * entry (TBD slots, late swaps) resolve to null and the drawer degrades.
 */

export const TEAM_STATS_AS_OF = "2026-06-04"; // HLTV world ranking + recent results snapshot

export type MatchResult = "W" | "L" | "T";

export interface RecentMatch {
  date: string; // DD/MM/YYYY, as published by the source
  opponent: string;
  score: string; // this team first, e.g. "2-1"
  result: MatchResult;
}

export interface TeamStats {
  worldRank: number | null; // HLTV world ranking position, null if unranked
  roster: string[]; // active lineup nicknames
  recent: RecentMatch[]; // most-recent first, up to 5
  hltvUrl: string; // canonical HLTV team profile (the dossier's data source)
}

/** pickid → frozen stats snapshot for the IEM Cologne 2026 field (32 teams). */

export const TEAM_STATS: Record<number, TeamStats> = {
  12: { // Natus Vincere
    worldRank: 2,
    roster: ["Aleksib", "iM", "b1t", "w0nderful", "makazze"],
    recent: [
      { date: "17/05/2026", opponent: "GamerLegion", score: "3-0", result: "W" },
      { date: "16/05/2026", opponent: "BetBoom", score: "2-0", result: "W" },
      { date: "15/05/2026", opponent: "Vitality", score: "2-1", result: "W" },
      { date: "13/05/2026", opponent: "Legacy", score: "1-2", result: "L" },
      { date: "12/05/2026", opponent: "GamerLegion", score: "2-1", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/4608/natus-vincere",
  },
  48: { // Liquid
    worldRank: 25,
    roster: ["NAF", "EliGE", "malbsMd", "siuhy", "ultimate"],
    recent: [
      { date: "03/06/2026", opponent: "MIBR", score: "10-13", result: "L" },
      { date: "02/06/2026", opponent: "BetBoom", score: "9-13", result: "L" },
      { date: "02/06/2026", opponent: "BIG", score: "13-10", result: "W" },
      { date: "21/05/2026", opponent: "The MongolZ", score: "1-2", result: "L" },
      { date: "20/05/2026", opponent: "3DMAX", score: "2-1", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/5973/liquid",
  },
  59: { // G2
    worldRank: 14,
    roster: ["huNter-", "NertZ", "SunPayus", "HeavyGod", "MATYS"],
    recent: [
      { date: "15/05/2026", opponent: "Spirit", score: "0-2", result: "L" },
      { date: "13/05/2026", opponent: "Monte", score: "2-0", result: "W" },
      { date: "12/05/2026", opponent: "PARIVISION", score: "2-1", result: "W" },
      { date: "11/05/2026", opponent: "The MongolZ", score: "0-2", result: "L" },
      { date: "10/05/2026", opponent: "MOUZ", score: "1-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/5995/g2",
  },
  60: { // Astralis
    worldRank: 12,
    roster: ["HooXi", "phzy", "jabbi", "Staehr", "ryu"],
    recent: [
      { date: "13/05/2026", opponent: "GamerLegion", score: "0-2", result: "L" },
      { date: "13/05/2026", opponent: "SINNERS", score: "2-0", result: "W" },
      { date: "12/05/2026", opponent: "Legacy", score: "0-2", result: "L" },
      { date: "11/05/2026", opponent: "Liquid", score: "2-0", result: "W" },
      { date: "01/05/2026", opponent: "GamerLegion", score: "0-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/6665/astralis",
  },
  69: { // BIG
    worldRank: 39,
    roster: ["tabseN", "JDC", "faveN", "blameF", "gr1ks"],
    recent: [
      { date: "03/06/2026", opponent: "THUNDER dOWNUNDER", score: "13-7", result: "W" },
      { date: "02/06/2026", opponent: "Gaimin Gladiators", score: "13-1", result: "W" },
      { date: "02/06/2026", opponent: "Liquid", score: "10-13", result: "L" },
      { date: "27/04/2026", opponent: "Nemiga", score: "0-2", result: "L" },
      { date: "26/04/2026", opponent: "SPARTA", score: "2-0", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/7532/big",
  },
  74: { // TYLOO
    worldRank: 29,
    roster: ["JamYoung", "Jee", "Mercury", "Moseyuh", "Zero"],
    recent: [
      { date: "03/06/2026", opponent: "SINNERS", score: "2-0", result: "W" },
      { date: "02/06/2026", opponent: "MIBR", score: "14-16", result: "L" },
      { date: "02/06/2026", opponent: "B8", score: "6-13", result: "L" },
      { date: "28/05/2026", opponent: "SemperFi", score: "3-0", result: "W" },
      { date: "26/05/2026", opponent: "Kaleido", score: "2-0", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/4863/tyloo",
  },
  80: { // MIBR
    worldRank: 19,
    roster: ["LNZ", "brnz4n", "insani", "venomzera", "kl1m"],
    recent: [
      { date: "03/06/2026", opponent: "Liquid", score: "13-10", result: "W" },
      { date: "02/06/2026", opponent: "TYLOO", score: "16-14", result: "W" },
      { date: "02/06/2026", opponent: "THUNDER dOWNUNDER", score: "6-13", result: "L" },
      { date: "23/05/2026", opponent: "MOUZ", score: "0-2", result: "L" },
      { date: "23/05/2026", opponent: "Legacy", score: "0-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/9215/mibr",
  },
  81: { // Spirit
    worldRank: 3,
    roster: ["sh1ro", "magixx", "tN1R", "zont1x", "donk"],
    recent: [
      { date: "17/05/2026", opponent: "Falcons", score: "3-0", result: "W" },
      { date: "16/05/2026", opponent: "MOUZ", score: "2-0", result: "W" },
      { date: "15/05/2026", opponent: "G2", score: "2-0", result: "W" },
      { date: "11/05/2026", opponent: "FURIA", score: "2-1", result: "W" },
      { date: "10/05/2026", opponent: "The MongolZ", score: "2-0", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/7020/spirit",
  },
  85: { // FURIA
    worldRank: 5,
    roster: ["FalleN", "yuurih", "YEKINDAR", "KSCERATO", "molodoy"],
    recent: [
      { date: "15/05/2026", opponent: "Falcons", score: "1-2", result: "L" },
      { date: "12/05/2026", opponent: "Gentle Mates", score: "2-1", result: "W" },
      { date: "11/05/2026", opponent: "Spirit", score: "1-2", result: "L" },
      { date: "10/05/2026", opponent: "HEROIC", score: "2-0", result: "W" },
      { date: "09/05/2026", opponent: "Monte", score: "2-0", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/8297/furia",
  },
  87: { // NRG
    worldRank: 33,
    roster: ["nitr0", "Sonic", "oSee", "Grim", "br0"],
    recent: [
      { date: "03/06/2026", opponent: "FlyQuest", score: "13-10", result: "W" },
      { date: "02/06/2026", opponent: "SINNERS", score: "13-6", result: "W" },
      { date: "02/06/2026", opponent: "GamerLegion", score: "10-13", result: "L" },
      { date: "20/05/2026", opponent: "MOUZ", score: "1-2", result: "L" },
      { date: "20/05/2026", opponent: "Legacy", score: "10-13", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/6673/nrg",
  },
  89: { // Vitality
    worldRank: 1,
    roster: ["apEX", "ropz", "ZywOo", "flameZ", "mezii"],
    recent: [
      { date: "15/05/2026", opponent: "Natus Vincere", score: "1-2", result: "L" },
      { date: "13/05/2026", opponent: "B8", score: "2-0", result: "W" },
      { date: "13/05/2026", opponent: "FaZe", score: "2-0", result: "W" },
      { date: "12/05/2026", opponent: "BetBoom", score: "1-2", result: "L" },
      { date: "11/05/2026", opponent: "BC.Game", score: "2-0", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/9565/vitality",
  },
  95: { // HEROIC
    worldRank: 27,
    roster: ["xfl0ud", "nilo", "susp", "Chr1zN", "yxngstxr"],
    recent: [
      { date: "03/06/2026", opponent: "Gaimin Gladiators", score: "2-0", result: "W" },
      { date: "02/06/2026", opponent: "Lynn Vision", score: "11-13", result: "L" },
      { date: "02/06/2026", opponent: "Sharks", score: "10-13", result: "L" },
      { date: "28/05/2026", opponent: "9z", score: "1-2", result: "L" },
      { date: "27/05/2026", opponent: "Ninjas in Pyjamas", score: "0-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/7175/heroic",
  },
  102: { // paiN
    worldRank: 18,
    roster: ["vsm", "biguzera", "piriajr", "saffee", "snow"],
    recent: [
      { date: "22/05/2026", opponent: "MOUZ", score: "0-2", result: "L" },
      { date: "21/05/2026", opponent: "TYLOO", score: "2-1", result: "W" },
      { date: "21/05/2026", opponent: "BC.Game", score: "2-0", result: "W" },
      { date: "20/05/2026", opponent: "M80", score: "8-13", result: "L" },
      { date: "15/05/2026", opponent: "GamerLegion", score: "1-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/4773/pain",
  },
  104: { // Sharks
    worldRank: 35,
    roster: ["gafolo", "koala", "maxxkor", "rdnzao", "doc"],
    recent: [
      { date: "03/06/2026", opponent: "Lynn Vision", score: "5-13", result: "L" },
      { date: "02/06/2026", opponent: "M80", score: "6-13", result: "L" },
      { date: "02/06/2026", opponent: "HEROIC", score: "13-10", result: "W" },
      { date: "29/05/2026", opponent: "FaZe", score: "0-2", result: "L" },
      { date: "29/05/2026", opponent: "Alliance", score: "2-0", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/8113/sharks",
  },
  106: { // MOUZ
    worldRank: 8,
    roster: ["torzsi", "Spinx", "xertioN", "xelex", "Jimpphat"],
    recent: [
      { date: "23/05/2026", opponent: "MIBR", score: "2-0", result: "W" },
      { date: "23/05/2026", opponent: "Falcons", score: "1-2", result: "L" },
      { date: "22/05/2026", opponent: "B8", score: "2-0", result: "W" },
      { date: "22/05/2026", opponent: "paiN", score: "2-0", result: "W" },
      { date: "21/05/2026", opponent: "M80", score: "2-1", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/4494/mouz",
  },
  112: { // 9z
    worldRank: 20,
    roster: ["max", "dgt", "meyern", "luchov", "HUASOPEEK"],
    recent: [
      { date: "29/05/2026", opponent: "FaZe", score: "1-2", result: "L" },
      { date: "28/05/2026", opponent: "HEROIC", score: "2-1", result: "W" },
      { date: "27/05/2026", opponent: "Sharks", score: "1-2", result: "L" },
      { date: "15/05/2026", opponent: "magic", score: "1-2", result: "L" },
      { date: "11/05/2026", opponent: "MOUZ", score: "2-1", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/9996/9z",
  },
  115: { // GamerLegion
    worldRank: 10,
    roster: ["Snax", "REZ", "Tauson", "PR", "hypex"],
    recent: [
      { date: "03/06/2026", opponent: "BetBoom", score: "0-2", result: "L" },
      { date: "02/06/2026", opponent: "FlyQuest", score: "13-11", result: "W" },
      { date: "02/06/2026", opponent: "NRG", score: "13-10", result: "W" },
      { date: "17/05/2026", opponent: "Natus Vincere", score: "0-3", result: "L" },
      { date: "16/05/2026", opponent: "Legacy", score: "2-1", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/9928/gamerlegion",
  },
  119: { // Monte
    worldRank: 24,
    roster: ["Rainwaker", "Bymas", "afro", "Gizmy", "AZUWU"],
    recent: [
      { date: "13/05/2026", opponent: "G2", score: "0-2", result: "L" },
      { date: "12/05/2026", opponent: "The Huns", score: "2-1", result: "W" },
      { date: "11/05/2026", opponent: "Falcons", score: "0-2", result: "L" },
      { date: "10/05/2026", opponent: "magic", score: "2-0", result: "W" },
      { date: "09/05/2026", opponent: "FURIA", score: "0-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/11811/monte",
  },
  122: { // The MongolZ
    worldRank: 9,
    roster: ["bLitz", "Techno", "mzinho", "910", "cobrazera"],
    recent: [
      { date: "22/05/2026", opponent: "Legacy", score: "1-2", result: "L" },
      { date: "22/05/2026", opponent: "PARIVISION", score: "2-0", result: "W" },
      { date: "21/05/2026", opponent: "Liquid", score: "2-1", result: "W" },
      { date: "20/05/2026", opponent: "B8", score: "1-2", result: "L" },
      { date: "20/05/2026", opponent: "Lynn Vision", score: "13-3", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/6248/the-mongolz",
  },
  126: { // Legacy
    worldRank: 7,
    roster: ["arT", "dumau", "latto", "n1ssim", "saadzin"],
    recent: [
      { date: "24/05/2026", opponent: "Falcons", score: "3-1", result: "W" },
      { date: "23/05/2026", opponent: "MIBR", score: "2-0", result: "W" },
      { date: "22/05/2026", opponent: "The MongolZ", score: "2-1", result: "W" },
      { date: "21/05/2026", opponent: "Falcons", score: "0-2", result: "L" },
      { date: "20/05/2026", opponent: "TYLOO", score: "2-0", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/12468/legacy",
  },
  127: { // Lynn Vision
    worldRank: 31,
    roster: ["Westmelon", "z4KR", "Starry", "EmiliaQAQ", "C4LLM3SU3"],
    recent: [
      { date: "03/06/2026", opponent: "Sharks", score: "13-5", result: "W" },
      { date: "02/06/2026", opponent: "HEROIC", score: "13-11", result: "W" },
      { date: "02/06/2026", opponent: "M80", score: "8-13", result: "L" },
      { date: "21/05/2026", opponent: "PARIVISION", score: "0-2", result: "L" },
      { date: "21/05/2026", opponent: "Ninjas in Pyjamas", score: "2-1", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/8840/lynn-vision",
  },
  132: { // FlyQuest
    worldRank: 81,
    roster: ["jks", "INS", "Vexite", "nettik", "story"],
    recent: [
      { date: "03/06/2026", opponent: "NRG", score: "10-13", result: "L" },
      { date: "02/06/2026", opponent: "GamerLegion", score: "11-13", result: "L" },
      { date: "02/06/2026", opponent: "SINNERS", score: "16-14", result: "W" },
      { date: "12/05/2026", opponent: "5star", score: "1-2", result: "L" },
      { date: "12/05/2026", opponent: "NEXVOID", score: "2-0", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/12774/flyquest",
  },
  134: { // Aurora
    worldRank: 6,
    roster: ["MAJ3R", "XANTARES", "woxic", "soulfly", "Wicadia"],
    recent: [
      { date: "15/05/2026", opponent: "MOUZ", score: "0-2", result: "L" },
      { date: "13/05/2026", opponent: "The MongolZ", score: "2-0", result: "W" },
      { date: "12/05/2026", opponent: "MOUZ", score: "0-2", result: "L" },
      { date: "11/05/2026", opponent: "PARIVISION", score: "2-0", result: "W" },
      { date: "10/05/2026", opponent: "The Huns", score: "2-0", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/11861/aurora",
  },
  135: { // B8
    worldRank: 16,
    roster: ["alex666", "npl", "kensizor", "esenthial", "s1zzi"],
    recent: [
      { date: "03/06/2026", opponent: "M80", score: "2-0", result: "W" },
      { date: "02/06/2026", opponent: "THUNDER dOWNUNDER", score: "13-11", result: "W" },
      { date: "02/06/2026", opponent: "TYLOO", score: "13-6", result: "W" },
      { date: "22/05/2026", opponent: "MOUZ", score: "0-2", result: "L" },
      { date: "21/05/2026", opponent: "MIBR", score: "1-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/11241/b8",
  },
  137: { // BetBoom
    worldRank: 21,
    roster: ["Boombl4", "zorte", "S1ren", "d1Ledez", "Magnojez"],
    recent: [
      { date: "03/06/2026", opponent: "GamerLegion", score: "2-0", result: "W" },
      { date: "02/06/2026", opponent: "Liquid", score: "13-9", result: "W" },
      { date: "02/06/2026", opponent: "Gaimin Gladiators", score: "13-4", result: "W" },
      { date: "17/05/2026", opponent: "Legacy", score: "0-2", result: "L" },
      { date: "16/05/2026", opponent: "Natus Vincere", score: "0-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/12394/betboom",
  },
  139: { // Falcons
    worldRank: 4,
    roster: ["karrigan", "NiKo", "TeSeS", "m0NESY", "kyousuke"],
    recent: [
      { date: "24/05/2026", opponent: "Legacy", score: "1-3", result: "L" },
      { date: "23/05/2026", opponent: "MOUZ", score: "2-1", result: "W" },
      { date: "21/05/2026", opponent: "Legacy", score: "2-0", result: "W" },
      { date: "20/05/2026", opponent: "M80", score: "2-0", result: "W" },
      { date: "20/05/2026", opponent: "BC.Game", score: "13-11", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/11283/falcons",
  },
  140: { // M80
    worldRank: 28,
    roster: ["slaxz-", "Swisher", "s1n", "JBa", "Lake"],
    recent: [
      { date: "03/06/2026", opponent: "B8", score: "0-2", result: "L" },
      { date: "02/06/2026", opponent: "Sharks", score: "13-6", result: "W" },
      { date: "02/06/2026", opponent: "Lynn Vision", score: "13-8", result: "W" },
      { date: "28/05/2026", opponent: "Voca", score: "3-1", result: "W" },
      { date: "26/05/2026", opponent: "Iowa Stormboar", score: "2-0", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/12376/m80",
  },
  142: { // PARIVISION
    worldRank: 11,
    roster: ["Jame", "BELCHONOKK", "xiELO", "nota", "zweih"],
    recent: [
      { date: "22/05/2026", opponent: "The MongolZ", score: "0-2", result: "L" },
      { date: "21/05/2026", opponent: "Lynn Vision", score: "2-0", result: "W" },
      { date: "20/05/2026", opponent: "MIBR", score: "0-2", result: "L" },
      { date: "19/05/2026", opponent: "Liquid", score: "13-9", result: "W" },
      { date: "12/05/2026", opponent: "G2", score: "1-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/12467/parivision",
  },
  145: { // FUT
    worldRank: 13,
    roster: ["dem0n", "lauNX", "Krabeni", "cmtry", "dziugss"],
    recent: [
      { date: "13/05/2026", opponent: "B8", score: "0-2", result: "L" },
      { date: "12/05/2026", opponent: "paiN", score: "1-2", result: "L" },
      { date: "11/05/2026", opponent: "NRG", score: "2-0", result: "W" },
      { date: "30/04/2026", opponent: "Astralis", score: "0-2", result: "L" },
      { date: "29/04/2026", opponent: "Vitality", score: "1-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/13286/fut",
  },
  146: { // Gaimin Gladiators
    worldRank: 142,
    roster: ["fer", "HEN1", "NEKIZ", "Luken", "JOTA"],
    recent: [
      { date: "03/06/2026", opponent: "HEROIC", score: "0-2", result: "L" },
      { date: "02/06/2026", opponent: "BIG", score: "1-13", result: "L" },
      { date: "02/06/2026", opponent: "BetBoom", score: "4-13", result: "L" },
      { date: "22/05/2026", opponent: "Inner Circle", score: "0-2", result: "L" },
      { date: "22/05/2026", opponent: "Acend", score: "0-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/11571/gaimin-gladiators",
  },
  147: { // SINNERS
    worldRank: 30,
    roster: ["beastik", "SHOCK", "MoDo", "kisserek", "stressarN"],
    recent: [
      { date: "03/06/2026", opponent: "TYLOO", score: "0-2", result: "L" },
      { date: "02/06/2026", opponent: "NRG", score: "6-13", result: "L" },
      { date: "02/06/2026", opponent: "FlyQuest", score: "14-16", result: "L" },
      { date: "13/05/2026", opponent: "Astralis", score: "0-2", result: "L" },
      { date: "12/05/2026", opponent: "Passion UA", score: "2-1", result: "W" },
    ],
    hltvUrl: "https://www.hltv.org/team/10577/sinners",
  },
  148: { // THUNDER dOWNUNDER
    worldRank: 69,
    roster: ["dexter", "Liazz", "aliStair", "asap", "TjP"],
    recent: [
      { date: "03/06/2026", opponent: "BIG", score: "7-13", result: "L" },
      { date: "02/06/2026", opponent: "B8", score: "11-13", result: "L" },
      { date: "02/06/2026", opponent: "MIBR", score: "13-6", result: "W" },
      { date: "27/05/2026", opponent: "SemperFi", score: "0-2", result: "L" },
      { date: "16/05/2026", opponent: "Lynn Vision", score: "1-2", result: "L" },
    ],
    hltvUrl: "https://www.hltv.org/team/13486/thunder-downunder",
  },
};

/** Frozen stats for a pickid, or null for TBD / unknown teams. */
export function statsForPickid(pickid: number): TeamStats | null {
  return TEAM_STATS[pickid] ?? null;
}
