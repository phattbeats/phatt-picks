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

/**
 * One active-lineup player (PHA-992). A bare screenname means nothing to a
 * newcomer, so each player carries their on-server role, HLTV rating, and a link
 * to their own HLTV profile. `position` is the player's primary real-world role
 * (IGL / AWP / Rifler — hand-curated, since HLTV publishes no structured role).
 * `rating` is HLTV's team-period rating off the team profile and `hltvUrl` their
 * personal profile; both are refreshed alongside the dossier (gather-roster).
 */
export interface RosterPlayer {
  name: string; // in-game nickname
  position: string; // primary role: "IGL" | "AWP" | "Rifler"
  rating: number | null; // HLTV rating on the current team, null if unrated
  hltvUrl: string; // personal HLTV player profile
  // Optional head-shot (PHA-1043). The Spotlight roster shows a player's face
  // next to their nick; the Swiss dossier ignores it. Source is HLTV's
  // `playerbodyshot` CDN (a signed, square-cropped w=100 URL lifted from the
  // team page), so it must be stored verbatim. Absent -> a monogram fallback.
  photo?: string;
}

export interface TeamStats {
  worldRank: number | null; // HLTV world ranking position, null if unranked
  roster: RosterPlayer[]; // active lineup, five players
  recent: RecentMatch[]; // most-recent first, up to 5
  hltvUrl: string; // canonical HLTV team profile (the dossier's data source)
}

/** pickid → frozen stats snapshot for the IEM Cologne 2026 field (32 teams). */

export const TEAM_STATS: Record<number, TeamStats> = {
  12: { // Natus Vincere
    worldRank: 2,
    roster: [
      { name: "Aleksib", position: "IGL", rating: 0.93, hltvUrl: "https://www.hltv.org/player/9816/aleksib" },
      { name: "iM", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/14759/im" },
      { name: "b1t", position: "Rifler", rating: 1.12, hltvUrl: "https://www.hltv.org/player/18987/b1t" },
      { name: "w0nderful", position: "AWP", rating: 1.12, hltvUrl: "https://www.hltv.org/player/20127/w0nderful" },
      { name: "makazze", position: "Rifler", rating: 1.13, hltvUrl: "https://www.hltv.org/player/22673/makazze" },
    ],
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
    roster: [
      { name: "NAF", position: "Rifler", rating: 1.14, hltvUrl: "https://www.hltv.org/player/8520/naf" },
      { name: "EliGE", position: "Rifler", rating: 1.05, hltvUrl: "https://www.hltv.org/player/8738/elige" },
      { name: "malbsMd", position: "Rifler", rating: 1.09, hltvUrl: "https://www.hltv.org/player/11617/malbsmd" },
      { name: "siuhy", position: "IGL", rating: 0.88, hltvUrl: "https://www.hltv.org/player/16820/siuhy" },
      { name: "ultimate", position: "AWP", rating: 1.02, hltvUrl: "https://www.hltv.org/player/21763/ultimate" },
    ],
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
    roster: [
      { name: "huNter-", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/3972/hunter" },
      { name: "NertZ", position: "Rifler", rating: 1.12, hltvUrl: "https://www.hltv.org/player/9436/nertz" },
      { name: "SunPayus", position: "AWP", rating: 1.06, hltvUrl: "https://www.hltv.org/player/19164/sunpayus" },
      { name: "HeavyGod", position: "Rifler", rating: 1.15, hltvUrl: "https://www.hltv.org/player/20447/heavygod" },
      { name: "MATYS", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/21062/matys" },
    ],
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
    roster: [
      { name: "HooXi", position: "IGL", rating: 0.89, hltvUrl: "https://www.hltv.org/player/10096/hooxi" },
      { name: "phzy", position: "Rifler", rating: 1.07, hltvUrl: "https://www.hltv.org/player/16726/phzy" },
      { name: "jabbi", position: "Rifler", rating: 1.06, hltvUrl: "https://www.hltv.org/player/17956/jabbi" },
      { name: "Staehr", position: "AWP", rating: 1.08, hltvUrl: "https://www.hltv.org/player/20304/staehr" },
      { name: "ryu", position: "Rifler", rating: 1.01, hltvUrl: "https://www.hltv.org/player/21217/ryu" },
    ],
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
    roster: [
      { name: "tabseN", position: "IGL", rating: 1.10, hltvUrl: "https://www.hltv.org/player/5794/tabsen" },
      { name: "JDC", position: "AWP", rating: 1.10, hltvUrl: "https://www.hltv.org/player/14929/jdc" },
      { name: "faveN", position: "Rifler", rating: 1.05, hltvUrl: "https://www.hltv.org/player/14932/faven" },
      { name: "blameF", position: "Rifler", rating: 1.24, hltvUrl: "https://www.hltv.org/player/15165/blamef" },
      { name: "gr1ks", position: "Rifler", rating: 1.15, hltvUrl: "https://www.hltv.org/player/22884/gr1ks" },
    ],
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
    roster: [
      { name: "JamYoung", position: "AWP", rating: 1.19, hltvUrl: "https://www.hltv.org/player/19645/jamyoung" },
      { name: "Jee", position: "Rifler", rating: 1.11, hltvUrl: "https://www.hltv.org/player/20702/jee" },
      { name: "Mercury", position: "IGL", rating: 1.08, hltvUrl: "https://www.hltv.org/player/20895/mercury" },
      { name: "Moseyuh", position: "Rifler", rating: 1.11, hltvUrl: "https://www.hltv.org/player/21621/moseyuh" },
      { name: "Zero", position: "Rifler", rating: 1.08, hltvUrl: "https://www.hltv.org/player/24857/zero" },
    ],
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
    roster: [
      { name: "LNZ", position: "Rifler", rating: 1.02, hltvUrl: "https://www.hltv.org/player/19310/lnz" },
      { name: "brnz4n", position: "IGL", rating: 1.08, hltvUrl: "https://www.hltv.org/player/20987/brnz4n" },
      { name: "insani", position: "AWP", rating: 1.20, hltvUrl: "https://www.hltv.org/player/21037/insani" },
      { name: "venomzera", position: "Rifler", rating: 1.06, hltvUrl: "https://www.hltv.org/player/21288/venomzera" },
      { name: "kl1m", position: "Rifler", rating: 1.23, hltvUrl: "https://www.hltv.org/player/23192/kl1m" },
    ],
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
    roster: [
      { name: "sh1ro", position: "AWP", rating: 1.18, hltvUrl: "https://www.hltv.org/player/16920/sh1ro", photo: "https://img-cdn.hltv.org/playerbodyshot/1V7ijAaTXl3umTr7cPo0VF.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=117%2C12%2C467%2C467&w=100&s=e815e7c88352c371883d77c63bb5ab7a" },
      { name: "magixx", position: "Rifler", rating: 1.05, hltvUrl: "https://www.hltv.org/player/18317/magixx", photo: "https://img-cdn.hltv.org/playerbodyshot/PONEIASU8jyJz2lnNS13bp.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=88ed0156a8f5fca66a6ab0f728748bf5" },
      { name: "tN1R", position: "Rifler", rating: 1.04, hltvUrl: "https://www.hltv.org/player/19808/tn1r", photo: "https://img-cdn.hltv.org/playerbodyshot/wi3shJIerTjUCELul_JOus.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=b7bc229d38620d56b1bd93c1c6e42717" },
      { name: "zont1x", position: "Rifler", rating: 1.09, hltvUrl: "https://www.hltv.org/player/20423/zont1x", photo: "https://img-cdn.hltv.org/playerbodyshot/Grz5vLIlrpeI7IQmm8d-jH.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=11f85e52de2c2992eadfcf7d6f7c46b0" },
      { name: "donk", position: "Rifler", rating: 1.40, hltvUrl: "https://www.hltv.org/player/21167/donk", photo: "https://img-cdn.hltv.org/playerbodyshot/C4b0sMnty05S40UmXhLRD4.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=5720722b6a57dce6b4c5f5242f69ea11" },
    ],
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
    roster: [
      { name: "FalleN", position: "IGL", rating: 0.98, hltvUrl: "https://www.hltv.org/player/2023/fallen", photo: "https://img-cdn.hltv.org/playerbodyshot/gQbb4I0TeHmxx7bYBOtd7T.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=117%2C8%2C467%2C467&w=100&s=fa88889550d37c1d6431b46de4ebd346" },
      { name: "yuurih", position: "Rifler", rating: 1.15, hltvUrl: "https://www.hltv.org/player/12553/yuurih", photo: "https://img-cdn.hltv.org/playerbodyshot/ZapU9KMKIlH1bDpSlV6MO1.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=124%2C8%2C467%2C467&w=100&s=a45761d0d76e3ba73ce9259495c269f6" },
      { name: "YEKINDAR", position: "Rifler", rating: 1.08, hltvUrl: "https://www.hltv.org/player/13915/yekindar", photo: "https://img-cdn.hltv.org/playerbodyshot/IO3vEa2fT2qFPRlrPid7hf.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=da2b1266b74e6038851bb304e5679172" },
      { name: "KSCERATO", position: "Rifler", rating: 1.19, hltvUrl: "https://www.hltv.org/player/15631/kscerato", photo: "https://img-cdn.hltv.org/playerbodyshot/z0vT0V815B0MdeeKhcf44Y.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=b27fcd6631f29d7931e43b0dea521094" },
      { name: "molodoy", position: "AWP", rating: 1.14, hltvUrl: "https://www.hltv.org/player/24144/molodoy", photo: "https://img-cdn.hltv.org/playerbodyshot/oPoWLYFq87cIs2cYDo8id7.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=a5a4830a878f1952a90ed9f942daa4f5" },
    ],
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
    roster: [
      { name: "nitr0", position: "IGL", rating: 1.05, hltvUrl: "https://www.hltv.org/player/7687/nitr0" },
      { name: "Sonic", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/8711/sonic" },
      { name: "oSee", position: "AWP", rating: 1.11, hltvUrl: "https://www.hltv.org/player/13249/osee" },
      { name: "Grim", position: "Rifler", rating: 1.05, hltvUrl: "https://www.hltv.org/player/13578/grim" },
      { name: "br0", position: "Rifler", rating: 1.13, hltvUrl: "https://www.hltv.org/player/16717/br0" },
    ],
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
    roster: [
      { name: "apEX", position: "IGL", rating: 1.00, hltvUrl: "https://www.hltv.org/player/7322/apex", photo: "https://img-cdn.hltv.org/playerbodyshot/3M9h08qvl3YOsaRcAvKhs4.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C0%2C467%2C467&w=100&s=04d9dbff54d199233368a0f35677b700" },
      { name: "ropz", position: "Rifler", rating: 1.16, hltvUrl: "https://www.hltv.org/player/11816/ropz", photo: "https://img-cdn.hltv.org/playerbodyshot/YQ9kQQ3aop1JZQE9xJ140r.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=117%2C8%2C467%2C467&w=100&s=0e87b5b49a484b8191bf18fb0bb5209c" },
      { name: "ZywOo", position: "AWP", rating: 1.32, hltvUrl: "https://www.hltv.org/player/11893/zywoo", photo: "https://img-cdn.hltv.org/playerbodyshot/blnoWFtH8GUJZjhr8H0P4u.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=3e2f64c057b9a697de74efc831d0e967" },
      { name: "flameZ", position: "Rifler", rating: 1.14, hltvUrl: "https://www.hltv.org/player/16693/flamez", photo: "https://img-cdn.hltv.org/playerbodyshot/LUQi5dX9boyO0uDadUGht5.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=ce93fe004f9085d1603f3ca148364b5b" },
      { name: "mezii", position: "Rifler", rating: 1.06, hltvUrl: "https://www.hltv.org/player/18462/mezii", photo: "https://img-cdn.hltv.org/playerbodyshot/7GVUrVLAQkgnuovRkk5Bxw.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=117%2C8%2C467%2C467&w=100&s=e489a038a337ee7ed99723743ef3ba3c" },
    ],
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
    roster: [
      { name: "xfl0ud", position: "AWP", rating: 1.08, hltvUrl: "https://www.hltv.org/player/19187/xfl0ud" },
      { name: "nilo", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/20119/nilo" },
      { name: "susp", position: "Rifler", rating: 1.00, hltvUrl: "https://www.hltv.org/player/21163/susp" },
      { name: "Chr1zN", position: "Rifler", rating: 0.95, hltvUrl: "https://www.hltv.org/player/21983/chr1zn" },
      { name: "yxngstxr", position: "Rifler", rating: 0.99, hltvUrl: "https://www.hltv.org/player/22047/yxngstxr" },
    ],
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
    roster: [
      { name: "vsm", position: "Rifler", rating: 1.00, hltvUrl: "https://www.hltv.org/player/16816/vsm" },
      { name: "biguzera", position: "Rifler", rating: 1.12, hltvUrl: "https://www.hltv.org/player/18141/biguzera" },
      { name: "piriajr", position: "Rifler", rating: 1.05, hltvUrl: "https://www.hltv.org/player/18714/piriajr" },
      { name: "saffee", position: "AWP", rating: 1.03, hltvUrl: "https://www.hltv.org/player/18835/saffee" },
      { name: "snow", position: "Rifler", rating: 1.01, hltvUrl: "https://www.hltv.org/player/20171/snow" },
    ],
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
    roster: [
      { name: "gafolo", position: "Rifler", rating: 1.06, hltvUrl: "https://www.hltv.org/player/20558/gafolo" },
      { name: "koala", position: "Rifler", rating: 1.14, hltvUrl: "https://www.hltv.org/player/21170/koala" },
      { name: "maxxkor", position: "Rifler", rating: 1.07, hltvUrl: "https://www.hltv.org/player/21221/maxxkor" },
      { name: "rdnzao", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/21921/rdnzao" },
      { name: "doc", position: "Rifler", rating: 1.16, hltvUrl: "https://www.hltv.org/player/22911/doc" },
    ],
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
    roster: [
      { name: "torzsi", position: "AWP", rating: 1.12, hltvUrl: "https://www.hltv.org/player/18072/torzsi" },
      { name: "Spinx", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/18221/spinx" },
      { name: "xertioN", position: "Rifler", rating: 1.13, hltvUrl: "https://www.hltv.org/player/20312/xertion" },
      { name: "xelex", position: "Rifler", rating: 1.09, hltvUrl: "https://www.hltv.org/player/24457/xelex" },
      { name: "Jimpphat", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/18850/jimpphat" },
    ],
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
    roster: [
      { name: "max", position: "Rifler", rating: 1.07, hltvUrl: "https://www.hltv.org/player/12092/max" },
      { name: "dgt", position: "AWP", rating: 1.18, hltvUrl: "https://www.hltv.org/player/14736/dgt" },
      { name: "meyern", position: "Rifler", rating: 1.03, hltvUrl: "https://www.hltv.org/player/14737/meyern" },
      { name: "luchov", position: "Rifler", rating: 1.18, hltvUrl: "https://www.hltv.org/player/20394/luchov" },
      { name: "HUASOPEEK", position: "Rifler", rating: 1.09, hltvUrl: "https://www.hltv.org/player/22613/huasopeek" },
    ],
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
    roster: [
      { name: "Snax", position: "IGL", rating: 0.89, hltvUrl: "https://www.hltv.org/player/2553/snax" },
      { name: "REZ", position: "Rifler", rating: 1.12, hltvUrl: "https://www.hltv.org/player/9278/rez" },
      { name: "Tauson", position: "AWP", rating: 1.03, hltvUrl: "https://www.hltv.org/player/20301/tauson" },
      { name: "PR", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/22279/pr" },
      { name: "hypex", position: "Rifler", rating: 1.02, hltvUrl: "https://www.hltv.org/player/23766/hypex" },
    ],
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
    roster: [
      { name: "Rainwaker", position: "IGL", rating: 1.14, hltvUrl: "https://www.hltv.org/player/17145/rainwaker" },
      { name: "Bymas", position: "Rifler", rating: 1.06, hltvUrl: "https://www.hltv.org/player/19015/bymas" },
      { name: "afro", position: "Rifler", rating: 1.12, hltvUrl: "https://www.hltv.org/player/19926/afro" },
      { name: "Gizmy", position: "Rifler", rating: 0.97, hltvUrl: "https://www.hltv.org/player/21816/gizmy" },
      { name: "AZUWU", position: "Rifler", rating: 1.00, hltvUrl: "https://www.hltv.org/player/22106/azuwu" },
    ],
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
    roster: [
      { name: "bLitz", position: "IGL", rating: 1.08, hltvUrl: "https://www.hltv.org/player/20194/blitz" },
      { name: "Techno", position: "Rifler", rating: 1.02, hltvUrl: "https://www.hltv.org/player/20275/techno" },
      { name: "mzinho", position: "Rifler", rating: 1.05, hltvUrl: "https://www.hltv.org/player/21001/mzinho" },
      { name: "910", position: "AWP", rating: 1.12, hltvUrl: "https://www.hltv.org/player/21809/910" },
      { name: "cobrazera", position: "Rifler", rating: 1.02, hltvUrl: "https://www.hltv.org/player/23402/cobrazera" },
    ],
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
    roster: [
      { name: "arT", position: "IGL", rating: 0.98, hltvUrl: "https://www.hltv.org/player/12521/art" },
      { name: "dumau", position: "Rifler", rating: 1.20, hltvUrl: "https://www.hltv.org/player/15698/dumau" },
      { name: "latto", position: "Rifler", rating: 1.18, hltvUrl: "https://www.hltv.org/player/19045/latto" },
      { name: "n1ssim", position: "Rifler", rating: 1.03, hltvUrl: "https://www.hltv.org/player/19686/n1ssim" },
      { name: "saadzin", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/22965/saadzin" },
    ],
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
    roster: [
      { name: "Westmelon", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/16551/westmelon" },
      { name: "z4KR", position: "AWP", rating: 1.16, hltvUrl: "https://www.hltv.org/player/18744/z4kr" },
      { name: "Starry", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/20254/starry" },
      { name: "EmiliaQAQ", position: "Rifler", rating: 1.04, hltvUrl: "https://www.hltv.org/player/22922/emiliaqaq" },
      { name: "C4LLM3SU3", position: "Rifler", rating: 1.00, hltvUrl: "https://www.hltv.org/player/23100/c4llm3su3" },
    ],
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
    roster: [
      { name: "jks", position: "Rifler", rating: 1.13, hltvUrl: "https://www.hltv.org/player/4679/jks" },
      { name: "INS", position: "Rifler", rating: 1.08, hltvUrl: "https://www.hltv.org/player/11140/ins" },
      { name: "Vexite", position: "AWP", rating: 1.08, hltvUrl: "https://www.hltv.org/player/17384/vexite" },
      { name: "nettik", position: "Rifler", rating: 1.05, hltvUrl: "https://www.hltv.org/player/18214/nettik" },
      { name: "story", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/20462/story" },
    ],
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
    roster: [
      { name: "MAJ3R", position: "IGL", rating: 0.89, hltvUrl: "https://www.hltv.org/player/150/maj3r", photo: "https://img-cdn.hltv.org/playerbodyshot/OHhj5VnQSq11DnTdsIvR2s.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=124%2C8%2C467%2C467&w=100&s=6b4de506ca55affcd5011e8aab040d8d" },
      { name: "XANTARES", position: "Rifler", rating: 1.16, hltvUrl: "https://www.hltv.org/player/7938/xantares", photo: "https://img-cdn.hltv.org/playerbodyshot/aEgLOOfzRrsHvRrKpL47rE.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=7e9ecb513c3b8f04ae2adba8e5dc3035" },
      { name: "woxic", position: "AWP", rating: 1.05, hltvUrl: "https://www.hltv.org/player/8574/woxic", photo: "https://img-cdn.hltv.org/playerbodyshot/2cF-tkevaAVy-qMjUWba4W.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=bf5ae47317fbb9a5b462b967bf1b9c51" },
      { name: "soulfly", position: "Rifler", rating: 1.01, hltvUrl: "https://www.hltv.org/player/20968/soulfly", photo: "https://img-cdn.hltv.org/playerbodyshot/ilIYrdas7tyZB8YsHqZjwq.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=124%2C0%2C467%2C467&w=100&s=0a476b3e4a80f32d8b98da98a03742b2" },
      { name: "Wicadia", position: "Rifler", rating: 1.12, hltvUrl: "https://www.hltv.org/player/21243/wicadia", photo: "https://img-cdn.hltv.org/playerbodyshot/Z9uIo6WYSEC5Sk9X6q-7BR.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=117%2C8%2C467%2C467&w=100&s=247a4c748843463badd702c4bc57d8c7" },
    ],
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
    roster: [
      { name: "alex666", position: "Rifler", rating: 1.04, hltvUrl: "https://www.hltv.org/player/20112/alex666" },
      { name: "npl", position: "IGL", rating: 1.16, hltvUrl: "https://www.hltv.org/player/21708/npl" },
      { name: "kensizor", position: "AWP", rating: 1.03, hltvUrl: "https://www.hltv.org/player/22842/kensizor" },
      { name: "esenthial", position: "Rifler", rating: 0.98, hltvUrl: "https://www.hltv.org/player/23643/esenthial" },
      { name: "s1zzi", position: "Rifler", rating: 0.99, hltvUrl: "https://www.hltv.org/player/25619/s1zzi" },
    ],
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
    roster: [
      { name: "Boombl4", position: "IGL", rating: 0.98, hltvUrl: "https://www.hltv.org/player/11840/boombl4" },
      { name: "zorte", position: "AWP", rating: 0.98, hltvUrl: "https://www.hltv.org/player/15662/zorte" },
      { name: "S1ren", position: "Rifler", rating: 1.06, hltvUrl: "https://www.hltv.org/player/18506/s1ren" },
      { name: "d1Ledez", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/20357/d1ledez" },
      { name: "Magnojez", position: "Rifler", rating: 1.16, hltvUrl: "https://www.hltv.org/player/21667/magnojez" },
    ],
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
    roster: [
      { name: "karrigan", position: "IGL", rating: 0.73, hltvUrl: "https://www.hltv.org/player/429/karrigan", photo: "https://img-cdn.hltv.org/playerbodyshot/xBsdjNQu8t41sc7_xp-oru.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=117%2C4%2C467%2C467&w=100&s=7f5bcaee6b2db48f62cf95f04c8bac8a" },
      { name: "NiKo", position: "Rifler", rating: 1.13, hltvUrl: "https://www.hltv.org/player/3741/niko", photo: "https://img-cdn.hltv.org/playerbodyshot/tNeWr2qE97l9huJU1Whcr7.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C8%2C467%2C467&w=100&s=2b677069d27dbb9fbc5563046ea27b69" },
      { name: "TeSeS", position: "Rifler", rating: 1.03, hltvUrl: "https://www.hltv.org/player/12018/teses", photo: "https://img-cdn.hltv.org/playerbodyshot/09IF7a6T90bzcmhtZ3zG6Z.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=121%2C0%2C467%2C467&w=100&s=8c4b3cfc22fb55e2daa95a5b5dc6ae7a" },
      { name: "m0NESY", position: "AWP", rating: 1.26, hltvUrl: "https://www.hltv.org/player/19230/m0nesy", photo: "https://img-cdn.hltv.org/playerbodyshot/2Qa6QeoErj6A7sK82UHQm9.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=124%2C0%2C467%2C467&w=100&s=5732dc74850751290d023050236f97a8" },
      { name: "kyousuke", position: "Rifler", rating: 1.17, hltvUrl: "https://www.hltv.org/player/24177/kyousuke", photo: "https://img-cdn.hltv.org/playerbodyshot/ve31sdQzcMJkyiFnSXeb6N.png?bg=3e4c54&h=100&ixlib=java-2.1.0&rect=124%2C0%2C467%2C467&w=100&s=4ccb2cf479e95fd4406628c22682555c" },
    ],
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
    roster: [
      { name: "slaxz-", position: "IGL", rating: 1.14, hltvUrl: "https://www.hltv.org/player/15370/slaxz" },
      { name: "Swisher", position: "Rifler", rating: 1.12, hltvUrl: "https://www.hltv.org/player/16599/swisher" },
      { name: "s1n", position: "Rifler", rating: 1.06, hltvUrl: "https://www.hltv.org/player/20104/s1n" },
      { name: "JBa", position: "Rifler", rating: 1.04, hltvUrl: "https://www.hltv.org/player/21665/jba" },
      { name: "Lake", position: "Rifler", rating: 1.15, hltvUrl: "https://www.hltv.org/player/22921/lake" },
    ],
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
    roster: [
      { name: "Jame", position: "AWP", rating: 1.13, hltvUrl: "https://www.hltv.org/player/13776/jame" },
      { name: "BELCHONOKK", position: "Rifler", rating: 1.07, hltvUrl: "https://www.hltv.org/player/19235/belchonokk" },
      { name: "xiELO", position: "Rifler", rating: 1.06, hltvUrl: "https://www.hltv.org/player/22471/xielo" },
      { name: "nota", position: "Rifler", rating: 1.04, hltvUrl: "https://www.hltv.org/player/22929/nota" },
      { name: "zweih", position: "Rifler", rating: 1.09, hltvUrl: "https://www.hltv.org/player/23685/zweih" },
    ],
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
    roster: [
      { name: "dem0n", position: "AWP", rating: 1.12, hltvUrl: "https://www.hltv.org/player/20584/dem0n" },
      { name: "lauNX", position: "Rifler", rating: 1.11, hltvUrl: "https://www.hltv.org/player/20761/launx" },
      { name: "Krabeni", position: "Rifler", rating: 1.05, hltvUrl: "https://www.hltv.org/player/22203/krabeni" },
      { name: "cmtry", position: "Rifler", rating: 1.03, hltvUrl: "https://www.hltv.org/player/22674/cmtry" },
      { name: "dziugss", position: "Rifler", rating: 1.11, hltvUrl: "https://www.hltv.org/player/23553/dziugss" },
    ],
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
    roster: [
      { name: "fer", position: "Rifler", rating: 0.86, hltvUrl: "https://www.hltv.org/player/8564/fer" },
      { name: "HEN1", position: "AWP", rating: 1.04, hltvUrl: "https://www.hltv.org/player/8565/hen1" },
      { name: "NEKIZ", position: "Rifler", rating: 0.91, hltvUrl: "https://www.hltv.org/player/9482/nekiz" },
      { name: "Luken", position: "Rifler", rating: 1.19, hltvUrl: "https://www.hltv.org/player/15914/luken" },
      { name: "JOTA", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/17861/jota" },
    ],
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
    roster: [
      { name: "beastik", position: "Rifler", rating: 0.99, hltvUrl: "https://www.hltv.org/player/11199/beastik" },
      { name: "SHOCK", position: "Rifler", rating: 1.06, hltvUrl: "https://www.hltv.org/player/12810/shock" },
      { name: "MoDo", position: "Rifler", rating: 1.09, hltvUrl: "https://www.hltv.org/player/21113/modo" },
      { name: "kisserek", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/23295/kisserek" },
      { name: "stressarN", position: "Rifler", rating: 1.10, hltvUrl: "https://www.hltv.org/player/23459/stressarn" },
    ],
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
    roster: [
      { name: "dexter", position: "IGL", rating: 1.04, hltvUrl: "https://www.hltv.org/player/9115/dexter" },
      { name: "Liazz", position: "Rifler", rating: 1.21, hltvUrl: "https://www.hltv.org/player/10588/liazz" },
      { name: "aliStair", position: "Rifler", rating: 1.19, hltvUrl: "https://www.hltv.org/player/11139/alistair" },
      { name: "asap", position: "Rifler", rating: 1.23, hltvUrl: "https://www.hltv.org/player/18545/asap" },
      { name: "TjP", position: "Rifler", rating: 1.02, hltvUrl: "https://www.hltv.org/player/20527/tjp" },
    ],
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
