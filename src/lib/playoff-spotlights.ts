/**
 * Playoff Spotlights (PHA-1043), the eight teams that survive Swiss are no
 * longer a row of stats. They're a narrative: who they were before Cologne and
 * what they became across Stage 1 → 3. The Spotlight replaces the clinical [i]
 * dossier on the *playoffs* picks page with a story, an event highlight, and a
 * live market line, while the roster / last-5 "tape" stays one tap below.
 *
 * DRAFT STATUS (2026-06-13): the real eight aren't seeded until Valve publishes
 * the bracket (~Jun 16, see PHA-993). FURIA (pickid 85) is the first real entry,
 * authored the moment they clinched 3-0; the others below are samples until each
 * team locks. This file is the single place an editor fills per team.
 *
 * HOW EACH OF THE EIGHT IS WRITTEN (the authoring template, Brandon asked):
 *   1. TRIGGER. A team is written the moment it clinches a playoff berth, using
 *      what actually happened at THIS event. No prophecy, no fabricated prose
 *      for un-clinched teams (they stay dossier-only until then).
 *   2. SOURCES. before/during come from the team's real run: HLTV results +
 *      ranking (already in team-stats-core) and the ESL highlight feed. tag and
 *      seedLine restate the verifiable record (e.g. "Advanced 3-0 from Stage 3").
 *   3. VOICE. Gravitas, not a recap (Brandon). Lead with the BIG human storyline,
 *      the career arc and the stakes, not just the scoreline: a legend's last
 *      year (FalleN), a redemption, a Cinderella run from Stage 1. BEFORE = who
 *      they were and what is on the line; NOW = what this run means against that
 *      weight. Two short phone-sized beats, every claim true and sourceable, no
 *      hype we can't back up. No em dashes (use ".", ",", ":").
 *   4. HIGHLIGHT. One official @ESLCSHighlights match reel for that team, trimmed
 *      to a 30-60s window via start/end (no re-hosting). Caption says what + when.
 *   5. ODDS are NOT committed here. They're fetched live (1h refresh) per matchup
 *      once the opponent is set; until then the modal shows "coming soon".
 */

/** A single viewable highlight from THIS event. */
export interface SpotlightHighlight {
  /**
   * Embed strategy. `youtube` is the default, ESL/IEM post per-match highlight
   * reels on YouTube during the event; an iframe (lazy, poster-first) is the one
   * reliable, zero-storage, mobile-clean option. `gif`/`mp4` left open for a
   * self-hosted short loop if we ever cut our own.
   */
  kind: "youtube" | "twitch-clip" | "gif" | "mp4";
  /** YouTube video id / Twitch clip slug / asset path, by `kind`. */
  src: string;
  /** Optional start offset in seconds (YouTube), to land on the play itself. */
  start?: number;
  /**
   * Optional end offset in seconds (YouTube). Paired with `start`, this trims a
   * full ESL match-highlights reel down to a single 30-60s run WITHOUT
   * re-hosting anything, the iframe just stops at `end`. This is how we get a
   * "30s-1m clip" out of a licensed source for free (Brandon, PHA-1043).
   */
  end?: number;
  /** Poster/thumbnail shown before tap (keeps the modal light on mobile). */
  poster?: string;
  /** One line under the clip: what you're watching + where in the run. */
  caption: string;
}

/** The story. Short, this reads on a phone, mid-pick. */
export interface SpotlightNarrative {
  /** All-caps hook, ~2-4 words. e.g. "THE FRENCH JUGGERNAUT". */
  tag: string;
  /** One line on how they got here. e.g. "Seeded #2 · 3-0 through Stage 1". */
  seedLine: string;
  /** Who they were walking in. 1-2 sentences. */
  before: string;
  /** What this event has made them. 1-2 sentences. */
  during: string;
}

export interface TeamSpotlight {
  pickid: number;
  narrative: SpotlightNarrative;
  highlight?: SpotlightHighlight;
}

/**
 * Authored drafts for likely qualifiers. Keyed by pickid. A team without an
 * entry falls back to the dossier-only view (no fabricated story), so this map
 * can fill in as the bracket seeds without shipping placeholder prose.
 */
const SPOTLIGHTS: Record<number, TeamSpotlight> = {
  // FURIA, pickid 85. FIRST REAL ENTRY (Brandon, 2026-06-13: "first team is
  // FURIA. good practice."). Narrative + highlight are sourced from this event,
  // not sample prose. FURIA clinched playoffs with a clean 3-0 Stage 3 Swiss run
  // (beat B8, MOUZ, then BB Team), verified via HLTV + the ESL highlight feed.
  85: {
    pickid: 85,
    narrative: {
      tag: "THE LAST DANCE",
      seedLine: "Advanced 3-0 from Stage 3 · B8, MOUZ, BB Team",
      before:
        "Gabriel 'FalleN' Toledo built Brazilian Counter-Strike from nothing and won the Major twice at its 2016 peak. At 34 he has named this his final year as a player. Cologne is one of the last times the godfather takes the Major stage that made him a legend.",
      during:
        "The old king is not going quietly, and he is not alone. FalleN steers while the AWP now belongs to molodoy, the 21-year-old pride of Kazakhstan and reigning Rookie of the Year, with KSCERATO and yuurih grinding beside them. A clean 3-0, and the torch passing from a legend to his heir in real time.",
    },
    // The official ESL per-match highlights reel for the clinch (BB Team vs
    // FURIA, "WINNER TO PLAYOFFS"), trimmed to a ~55s window so the modal plays
    // a short clip, not a 6-minute VOD. start/end do the "stripping" for free,
    // no re-hosting, licensed source. Editor can nudge the window to the exact
    // round; the reel is wall-to-wall action so any window lands on a play.
    highlight: {
      kind: "youtube",
      src: "-VGUL80yL00", // @ESLCSHighlights, verified via oEmbed 2026-06-13
      start: 8, // skip the branded intro card
      end: 63, // ~55s clip
      caption: "FURIA close BB Team to advance 3-0, Stage 3 (ESL highlights)",
    },
  },
  // Team Spirit, pickid 81. SECOND REAL ENTRY (Brandon, 2026-06-14: "SPIRIT is
  // also one of the 3-0 picks, make that so we know the pipeline works"). Clean
  // 3-0 Stage 3 Swiss run (beat NaVi, Aurora, 9z), verified via HLTV + the ESL
  // highlight feed; storyline-first per the template (donk, best player alive).
  81: {
    pickid: 81,
    narrative: {
      tag: "THE BEST IN THE WORLD",
      seedLine: "Advanced 3-0 from Stage 3 · NaVi, Aurora, 9z",
      before:
        "Team Spirit are built around donk, the phenom who won a Major MVP at 16 and has been called the best player alive ever since. Beside him stands sh1ro, a former Major champion and one of the deadliest AWPers of his generation.",
      during:
        "At Cologne the hype has looked modest. donk put up one of the most dominant individual runs the Major has seen on a clean 3-0 over NaVi, Aurora, and 9z, Spirit barely conceding a round. Right now the rest of the bracket is playing for second.",
    },
    // Official ESL per-match reel for the 9z clinch ("CRAZY GAME!"), trimmed to a
    // ~55s window via start/end (no re-hosting), same recipe as FURIA.
    highlight: {
      kind: "youtube",
      src: "G0PbejF_8VA", // @ESLCSHighlights, verified via oEmbed 2026-06-14
      start: 8,
      end: 63,
      caption: "Spirit close 9z to advance 3-0, Stage 3 (ESL highlights)",
    },
  },
  // Aurora, pickid 134. THIRD REAL ENTRY (PHA-1065, authored 2026-06-14 the day
  // they clinched). Advanced 3-1 from the Stage 3 Swiss (beat Monte, G2, 9z; one
  // loss to Spirit), sealed by woxic's 1v4 on Dust2 in the decider, verified via
  // HLTV (event 8301, news 44902) + the ESL highlight feed. Storyline-first per
  // the template: Turkish CS finally back among the last eight.
  134: {
    pickid: 134,
    narrative: {
      tag: "A NATION'S RETURN",
      seedLine: "Advanced 3-1 from Stage 3 · Monte, G2, 9z",
      before:
        "Aurora carry Turkish Counter-Strike on their backs. XANTARES has been the face of the scene for a decade, the most explosive entry rifler of his generation, and for all of it a deep Major run has stayed just out of reach. MAJ3R, the veteran in-game leader, has spent a career trying to take a Turkish core to a stage like this.",
      during:
        "At Cologne they crossed through. A 3-1 over Monte, G2, and 9z, sealed when woxic stood up in a 1v4 on Dust2 with the berth on the line and won it. Their first run to a Major playoff stage since Copenhagen 2024, the Turkish core back among the last eight.",
    },
    highlight: {
      kind: "youtube",
      src: "eAWapDuMuas", // @ESLCSHighlights, oEmbed-verified 2026-06-14
      start: 8,
      end: 63,
      caption: "Aurora close 9z to advance 3-1, Stage 3 (ESL highlights)",
    },
  },
  // Vitality, pickid 89. FOURTH REAL ENTRY (PHA-1065, authored 2026-06-14). The
  // world #1 advanced 3-1 from Stage 3 (beat FUT, MOUZ, BetBoom; an upset loss to
  // 9z along the way), clinched on a clean 2-0 over BetBoom with ZywOo at 1.66,
  // verified via HLTV (event 8301, news 44903) + the ESL feed.
  89: {
    pickid: 89,
    narrative: {
      tag: "THE BURDEN OF FIRST",
      seedLine: "Advanced 3-1 from Stage 3 · FUT, MOUZ, BetBoom",
      before:
        "Vitality came to Cologne ranked number one in the world, built around ZywOo, the AWPer most of the scene calls the best player alive. apEX leads them, the captain who rebuilt his career around that talent. When you are the favorite, anything short of a deep run reads as failure, and they know it.",
      during:
        "Stage 3 made them earn it. An upset loss to 9z, then two three-map grinds past FUT and MOUZ, before a clean 2-0 over BetBoom to advance with ZywOo posting a 1.66 in the clincher. Not the procession the ranking implies, but the world number one is through to the bracket where it means to settle things.",
    },
    highlight: {
      kind: "youtube",
      src: "hQ__kpIsFdI", // @ESLCSHighlights, oEmbed-verified 2026-06-14
      start: 8,
      end: 63,
      caption: "Vitality close BetBoom to advance 3-1, Stage 3 (ESL highlights)",
    },
  },
  // Falcons, pickid 139. FIFTH REAL ENTRY (PHA-1065, authored 2026-06-14).
  // Advanced 3-1 from Stage 3 (beat G2, Monte, NAVI; one loss to BetBoom), the
  // NAVI win on the final Swiss day the clinch, verified via HLTV (event 8301,
  // news 44910/44911) + the ESL feed. Storyline-first: the superteam chasing the
  // one trophy its biggest star has never won.
  139: {
    pickid: 139,
    narrative: {
      tag: "THE MISSING CROWN",
      seedLine: "Advanced 3-1 from Stage 3 · G2, Monte, NAVI",
      before:
        "Falcons were assembled to win a Major. NiKo is one of the finest riflers the game has produced and, for all of it, has never lifted the trophy. m0NESY is the prodigy AWP chasing his first. karrigan, the in-game leader who has stood on that stage and won it, was brought in to take them back.",
      during:
        "Stage 3 went the distance. A 3-1 through G2 and Monte, then a 2-1 over NAVI on the final Swiss day to reach the LANXESS Arena. NiKo has already named the ambition out loud, that this group is built to repeat what karrigan once did. The bracket is where that gets tested.",
    },
    highlight: {
      kind: "youtube",
      src: "t3-h7KOVqOM", // @ESLCSHighlights, oEmbed-verified 2026-06-14
      start: 8,
      end: 63,
      caption: "Falcons close NAVI to advance 3-1, Stage 3 (ESL highlights)",
    },
  },
  // 9z, pickid 112. SIXTH REAL ENTRY (PHA-1198 wave 2, authored 2026-06-15 on
  // clinch). Advanced 3-2 from Stage 3 (beat PARIVISION, Vitality, The MongolZ;
  // losses to Spirit and Aurora), the MongolZ win a win or go home decider that
  // dgt closed with an ace on Overpass. Verified via HLTV (event 8301, clinch
  // match 2394993) + the ESL feed. Storyline-first: the first South American
  // team without a Brazilian core to reach a Major playoff.
  112: {
    pickid: 112,
    narrative: {
      tag: "BEYOND BRAZIL",
      seedLine: "Advanced 3-2 from Stage 3 · PARIVISION, Vitality, The MongolZ",
      before:
        "For twenty years South American Counter-Strike has meant Brazil. 9z carry the other half of the continent, an Argentine organization with a roster drawn from Argentina, Uruguay and Chile, the Spanish speaking scene that had never broken through at a Major.",
      during:
        "At Cologne they broke through. 9z upset the world number one Vitality in the Swiss, then won a do or die decider against The MongolZ, dgt closing it with an ace on Overpass. It is the first time a South American team without a Brazilian core has reached a Major playoff, and luchov, the 25 year old who carried them all event, has them in the last eight.",
    },
    // Official ESL per-match reel for the MongolZ clinch ("LAST CHANCE!"),
    // trimmed to a ~55s window via start/end, same recipe as the rest.
    highlight: {
      kind: "youtube",
      src: "keOcraGlS54", // @ESLCSHighlights, oEmbed-verified 2026-06-15
      start: 8,
      end: 63,
      caption: "9z close The MongolZ to advance 3-2, Stage 3 (ESL highlights)",
    },
  },
  // BetBoom, pickid 137. SEVENTH REAL ENTRY (PHA-1198 wave 2, authored
  // 2026-06-15 on clinch). Advanced 3-2 from Stage 3 (beat The MongolZ, Falcons,
  // FUT; losses to FURIA and Vitality), the FUT sweep a 2-2 elimination decider.
  // Verified via HLTV (event 8301, clinch match 2394994) + the ESL feed.
  // Note: S1ren is BetBoom's registered fifth, but loanee fl4mus (ex-Virtus.pro)
  // stood in across all five Stage 3 matches; the dossier shows the registered
  // roster HLTV lists. Storyline-first: the Major-winning captain's road back.
  137: {
    pickid: 137,
    narrative: {
      tag: "THE LONG WAY BACK",
      seedLine: "Advanced 3-2 from Stage 3 · The MongolZ, Falcons, FUT",
      before:
        "Boombl4 once stood at the very top. In 2021 he was the in game leader who captained Natus Vincere to the Stockholm Major, the organization's first, on a roster whose star s1mple was the tournament MVP. Then he was released, and spent years in the tier below the one he had ruled.",
      during:
        "At Cologne the captain found his way back. At the head of an all Russian lineup built on players in their early twenties, BetBoom beat The MongolZ and Falcons, survived losses to FURIA and Vitality, then swept FUT in a win or go home decider to reach the bracket. The man who once lifted the trophy is back among the last eight.",
    },
    // Official ESL per-match reel for the FUT clinch ("LAST CHANCE!"), trimmed
    // to a ~55s window via start/end, same recipe as the rest.
    highlight: {
      kind: "youtube",
      src: "MhC0VgllurE", // @ESLCSHighlights, oEmbed-verified 2026-06-15
      start: 8,
      end: 63,
      caption: "BetBoom sweep FUT to advance 3-2, Stage 3 (ESL highlights)",
    },
  },
  // G2, pickid 59. EIGHTH REAL ENTRY (PHA-1198 wave 2, authored 2026-06-15 on
  // clinch). Advanced 3-2 from Stage 3 (beat FUT, Legacy, NAVI; losses to
  // Falcons and Aurora), the NAVI win a 2-2 decider that went the full distance
  // (overtime on Inferno, then Mirage). Verified via HLTV (event 8301, clinch
  // match 2394995) + the ESL feed. Storyline-first: the superteam dismantled and
  // rebuilt around youth, back in a Major playoff.
  59: {
    pickid: 59,
    narrative: {
      tag: "THE REBUILD",
      seedLine: "Advanced 3-2 from Stage 3 · FUT, Legacy, NAVI",
      before:
        "A year ago G2 were a superteam built around NiKo and m0NESY, and it did not work. Both stars left for Falcons in 2025, and the organization said so plainly, that it had tried to build a future with them and failed. What was left was huNter, the lone holdover from the old core, and a young, cheaper lineup nobody expected to contend.",
      during:
        "That young G2 has arrived. Through the Stage 3 gauntlet they survived an elimination match with Legacy, then beat NAVI in a 2-2 decider that went the full distance, an overtime escape on Inferno before closing Mirage. HeavyGod, already an MVP this year at BLAST Open London, and MATYS carried a rebuilt roster into the last eight.",
    },
    // Official ESL per-match reel for the NAVI clinch ("LAST SPOT FOR
    // PLAYOFFS!"), trimmed to a ~55s window via start/end, same recipe.
    highlight: {
      kind: "youtube",
      src: "oVt4EwPR4Qo", // @ESLCSHighlights, oEmbed-verified 2026-06-15
      start: 8,
      end: 63,
      caption: "G2 close NAVI to advance 3-2, Stage 3 (ESL highlights)",
    },
  },
  // All eight playoff teams are now authored (FURIA, Spirit, Aurora, Vitality,
  // Falcons, 9z, BetBoom, G2). A pickid with no entry still renders the
  // dossier-only fallback (roster + last 5), never a placeholder story.
};

/** The team's spotlight draft, or null if none authored (→ dossier fallback). */
export function spotlightForPickid(pickid: number): TeamSpotlight | null {
  return SPOTLIGHTS[pickid] ?? null;
}

/**
 * Pickids of every team with an authored spotlight, in insertion order (PHA-1043
 * follow-up). The playoffs page drives its "Qualified for Playoffs" anticipation
 * strip off this before Valve seeds the bracket: as the pipeline authors each
 * newly-clinched team, that team appears in the strip automatically. Once the
 * bracket seeds and real picker tiles exist, the strip yields to them.
 */
export function authoredSpotlightPickids(): number[] {
  return Object.keys(SPOTLIGHTS).map(Number);
}

/**
 * Per-team accent color (PHA-1043 follow-up, Brandon: each spotlight wears the
 * team's own color, not the house orange). Keyed by logo slug so it resolves for
 * every playoff team whether or not a narrative is authored yet. Each hue keeps
 * the team's recognizable color but is tuned to clear WCAG AA (>= 4.5:1) as text
 * against the lightest panel surface (`--surf-3` #35291f), since the accent is
 * used for readable text, not just fills. verify-team-accent enforces this so a
 * future color cannot regress contrast. Monochrome orgs (g2, furi) get a light
 * neutral. Unknown slug yields null, and the modal keeps the house `--heat`.
 */
const TEAM_ACCENT: Record<string, string> = {
  navi: "#f4d11e",
  liq: "#4c95e6",
  g2: "#aeb4bd",
  astr: "#ff5575",
  big: "#4a96e8",
  tyl: "#e96d72",
  mibr: "#f2c200",
  spir: "#ec6c70",
  furi: "#d9d9d9",
  nrg: "#e96c6c",
  vita: "#f2c511",
  hero: "#e76b70",
  pain: "#ea686e",
  shrk: "#1f9be0",
  mouz: "#f36368",
  nine: "#15d3a8",
  gl: "#3da74c",
  mont: "#e27171",
  mngz: "#5094f0",
  lgcy: "#2ec26a",
  lynn: "#ea6b6b",
  fq: "#1faf5a",
  aura: "#9880ff",
  b8: "#f2c500",
  bb: "#ffd400",
  fal: "#16c172",
  m80: "#5798f1",
  pari: "#f2841f",
  fut: "#eb7272",
  gaim: "#a87bf3",
  sinn: "#dd7469",
  thun: "#facb00",
};

/** The team's accent color (hex), or null to fall back to the house `--heat`. */
export function teamAccent(team: { logo: string }): string | null {
  return TEAM_ACCENT[team.logo] ?? null;
}

/** Build the YouTube privacy-enhanced embed URL for a highlight. */
export function youtubeEmbedUrl(h: SpotlightHighlight): string | null {
  if (h.kind !== "youtube") return null;
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  if (h.start) params.set("start", String(h.start));
  // `end` trims the reel to a short clip (the iframe stops playing at `end`).
  if (h.end) params.set("end", String(h.end));
  return `https://www.youtube-nocookie.com/embed/${h.src}?${params.toString()}`;
}

/** Poster frame for a YouTube highlight (used before the iframe mounts). */
export function youtubePoster(h: SpotlightHighlight): string | null {
  if (h.poster) return h.poster;
  if (h.kind !== "youtube") return null;
  return `https://i.ytimg.com/vi/${h.src}/hqdefault.jpg`;
}
