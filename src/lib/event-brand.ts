/**
 * Per-Major brand dressing: the organiser's event mark (white on transparent,
 * under /public/watch) and its official English broadcast channels. Read by
 * Watch Now, the stage reveal and the Wrapped decks, so each surface shows the
 * Major it's about instead of a hard-coded one.
 *
 * Channels are the organiser's primary English streams: Cologne from ESL
 * (verified 2026-06-05), Singapore from PGL per Liquipedia's PGL/2026/Singapore
 * stream table (verified 2026-10-19).
 */

export interface EventBrand {
  logo: { src: string; alt: string; width: number; height: number };
  /** "the official X broadcast" line in Watch Now. */
  broadcast: string;
  streams: { youtube: string; twitch: string; kick: string };
}

const BRANDS: Record<string, EventBrand> = {
  "iem-cologne-2026": {
    logo: { src: "/watch/iem-cologne.png", alt: "Intel Extreme Masters · ESL Cologne Major 2026", width: 1920, height: 1013 },
    broadcast: "IEM Cologne Major 2026",
    streams: { youtube: "ESLCS", twitch: "eslcs", kick: "eslcs" },
  },
  "pgl-singapore-2026": {
    logo: { src: "/watch/pgl-singapore.png", alt: "PGL Major Singapore 2026", width: 717, height: 1013 },
    broadcast: "PGL Major Singapore 2026",
    streams: { youtube: "PGL", twitch: "pgl", kick: "pgl" },
  },
};

/** The brand for a Major, or null for one that hasn't been dressed yet. */
export function eventBrand(slug: string | null | undefined): EventBrand | null {
  return (slug && BRANDS[slug]) || null;
}

/** The Major's mark, falling back to Cologne's so a deck never renders logo-less. */
export function eventLogoSrc(slug: string | null | undefined): string {
  return eventBrand(slug)?.logo.src ?? BRANDS["iem-cologne-2026"].logo.src;
}
