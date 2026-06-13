/**
 * Playoff Spotlights (PHA-1043) — the eight teams that survive Swiss are no
 * longer a row of stats. They're a narrative: who they were before Cologne and
 * what they became across Stage 1 → 3. The Spotlight replaces the clinical [i]
 * dossier on the *playoffs* picks page with a story, an event highlight, and a
 * live market line — while the roster / last-5 "tape" stays one tap below.
 *
 * DRAFT STATUS (2026-06-13): the real eight aren't seeded until Valve publishes
 * the bracket (~Jun 16, see PHA-993). So narratives + highlight ids here are
 * authored samples for likely qualifiers, enough to prove the design. Once the
 * field is locked, this file is the single place an editor fills per team:
 *   narrative (before/during), one event-highlight clip id, a short tag.
 * Odds are NOT committed here — they're fetched live (1h refresh) per matchup;
 * see `market-odds-core` / `market-odds`.
 */

/** A single viewable highlight from THIS event. */
export interface SpotlightHighlight {
  /**
   * Embed strategy. `youtube` is the default — ESL/IEM post per-match highlight
   * reels on YouTube during the event; an iframe (lazy, poster-first) is the one
   * reliable, zero-storage, mobile-clean option. `gif`/`mp4` left open for a
   * self-hosted short loop if we ever cut our own.
   */
  kind: "youtube" | "twitch-clip" | "gif" | "mp4";
  /** YouTube video id / Twitch clip slug / asset path, by `kind`. */
  src: string;
  /** Optional start offset in seconds (YouTube), to land on the play itself. */
  start?: number;
  /** Poster/thumbnail shown before tap (keeps the modal light on mobile). */
  poster?: string;
  /** One line under the clip: what you're watching + where in the run. */
  caption: string;
}

/** The story. Short — this reads on a phone, mid-pick. */
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
  // Na'Vi — pickid 12
  12: {
    pickid: 12,
    narrative: {
      tag: "THE COMEBACK ARC",
      seedLine: "Sample draft · narrative fills when seeded",
      before:
        "World #2 on paper, but a roster still answering the question of whether makazze and w0nderful could carry a Major when it mattered. The pedigree was never in doubt; the nerve was.",
      during:
        "Answered it. A clean Swiss run with w0nderful posting top-3 AWP numbers of the event turned 'dangerous' into 'feared.' This is the version of Na'Vi the bracket was scared of.",
    },
    highlight: {
      kind: "youtube",
      src: "dQw4w9WgXcQ", // DRAFT placeholder id — swap for the real event reel
      caption: "w0nderful 1v3 to close the half vs MOUZ — Stage 2 (sample clip)",
    },
  },
  // Liquid — pickid 48
  48: {
    pickid: 48,
    narrative: {
      tag: "THE LONG ROAD",
      seedLine: "Sample draft · narrative fills when seeded",
      before:
        "World #25 and written off — a NA core that hadn't troubled a top side in months. Nobody's bracket had Liquid past Stage 1.",
      during:
        "The story of the tournament. Fought up from the 0-1 pool, knocked out two seeded Europeans, and dragged a 'rebuild year' all the way to the playoff eight. The room they're not supposed to be in.",
    },
    highlight: {
      kind: "youtube",
      src: "dQw4w9WgXcQ", // DRAFT placeholder id
      caption: "ultimate's last-round AWP hold to advance — Stage 1 decider (sample clip)",
    },
  },
};

/** The team's spotlight draft, or null if none authored (→ dossier fallback). */
export function spotlightForPickid(pickid: number): TeamSpotlight | null {
  return SPOTLIGHTS[pickid] ?? null;
}

/**
 * Per-team accent color (PHA-1043 follow-up — Brandon: each spotlight wears the
 * team's own color, not the house orange). Keyed by logo slug so it resolves for
 * every playoff team whether or not a narrative is authored yet. Each hue is
 * picked to read as a bright accent against the dark panel; monochrome orgs get
 * their nearest recognizable brand hue. Unknown slug → null → the modal keeps
 * the house `--heat`.
 */
const TEAM_ACCENT: Record<string, string> = {
  navi: "#f4d11e",
  liq: "#1f7ae0",
  g2: "#aeb4bd",
  astr: "#e4002b",
  big: "#1763b5",
  tyl: "#d11f26",
  mibr: "#f2c200",
  spir: "#e21f26",
  furi: "#d9d9d9",
  nrg: "#e23b3b",
  vita: "#f2c511",
  hero: "#d8232a",
  pain: "#e0202a",
  shrk: "#1f9be0",
  mouz: "#ed1c24",
  nine: "#15d3a8",
  gl: "#3ca34a",
  mont: "#d12b2b",
  mngz: "#2f80ed",
  lgcy: "#2ec26a",
  lynn: "#e23636",
  fq: "#1faf5a",
  aura: "#7b5cff",
  b8: "#f2c500",
  bb: "#ffd400",
  fal: "#16c172",
  m80: "#2f80ed",
  pari: "#f2841f",
  fut: "#e23636",
  gaim: "#7c3aed",
  sinn: "#c0392b",
  thun: "#f2c500",
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
  return `https://www.youtube-nocookie.com/embed/${h.src}?${params.toString()}`;
}

/** Poster frame for a YouTube highlight (used before the iframe mounts). */
export function youtubePoster(h: SpotlightHighlight): string | null {
  if (h.poster) return h.poster;
  if (h.kind !== "youtube") return null;
  return `https://i.ytimg.com/vi/${h.src}/hqdefault.jpg`;
}
