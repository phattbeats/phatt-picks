/**
 * Team storylines + montage clips for the Singapore Major field. One shared
 * data file (fixtures/singapore-stories.json, keyed by Valve pickid) so the
 * team page, the rosters view and the home grid read the same copy. Pure.
 *
 * Clips are embeds only — we never re-host video. Every story lists the
 * sources its claims rest on.
 */

import stories from "@/fixtures/singapore-stories.json";

export interface StoryClip {
  kind: "youtube";
  /** YouTube video id (11 chars). */
  id: string;
  start?: number;
  title: string;
  channel: string;
  /** Why it's here, ≤12 words. */
  why?: string;
  /** Who published it: team channel / PGL / HLTV / community editor. */
  source: string;
}

export interface StorySource {
  label: string;
  url: string;
  date?: string;
}

export interface TeamStory {
  pickid: number;
  slug: string;
  name: string;
  hltvId: number | null;
  hltvSlug: string | null;
  /** Brand colour, readable on the dark UI. */
  color: string;
  headline: string;
  storyline: string;
  sources: StorySource[];
  clips: StoryClip[];
}

interface StoryFile {
  asOf: string;
  teams: Record<string, TeamStory>;
}

const FILE = stories as unknown as StoryFile;

export const STORIES_AS_OF = FILE.asOf;

export function storyForPickid(pickid: number): TeamStory | null {
  return FILE.teams[String(pickid)] ?? null;
}

export function storyForSlug(slug: string): TeamStory | null {
  const s = slug.toLowerCase();
  return Object.values(FILE.teams).find((t) => t.slug === s) ?? null;
}

/** HLTV team page for a story, or null when the id isn't confirmed. */
export function hltvTeamUrl(s: TeamStory): string | null {
  return s.hltvId != null && s.hltvSlug ? `https://www.hltv.org/team/${s.hltvId}/${s.hltvSlug}` : null;
}

export function youtubeWatchUrl(c: StoryClip): string {
  return `https://www.youtube.com/watch?v=${c.id}${c.start ? `&t=${c.start}s` : ""}`;
}

/** Privacy-enhanced embed URL; only loaded after the viewer taps play. */
export function youtubeEmbedSrc(c: StoryClip): string {
  const p = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1", autoplay: "1" });
  if (c.start) p.set("start", String(c.start));
  return `https://www.youtube-nocookie.com/embed/${c.id}?${p.toString()}`;
}
