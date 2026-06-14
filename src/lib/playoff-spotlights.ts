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
  // The other six fill in here as each team clinches (PHA-1065), authored from
  // their real run per the template above. Until then a playoff team with no
  // entry renders the dossier-only fallback (roster + last 5), never a
  // placeholder story, so nothing fabricated can ship.
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
