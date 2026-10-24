/**
 * Site photography: documentary stills from the IEM Cologne Major 2026 HLTV
 * galleries, one per surface so no two heroes share a shot. Files and their
 * sources are listed in public/photos/CREDITS.md; every surface credits them
 * "Photo · HLTV". The Wrapped recap deck keeps its own story stills
 * (COLOGNE_PHOTOS in playoff-wrapped-core.ts).
 */

const p = (name: string) => `/photos/${name}.jpg`;

/** Fixed slots: the surface a shot belongs to. */
export const PHOTOS = {
  homeHero: p("arena-gold"),
  homeChampion: p("energy-trophy-lift"),
  splash: p("arena-red"),
  localSignIn: p("crowd-sign"),
  picksHeader: p("arena-red-smoke"),
  picksPlayoffs: p("arena-blue"),
  picksNotOpen: p("energy-smoke-walkout"),
  howToPlayHero: p("arena-stage"),
  howToPlayCommunity: p("crowd-march"),
  howToPlayNations: p("crowd-flag-brazil"),
  newsHero: p("arena-night"),
  leaderboardLive: p("crowd-red-smoke"),
  leaderboardFinal: p("energy-confetti"),
  compareHero: p("emotion-fist"),
  coinsHero: p("energy-trophy-red"),
  phattIdHero: p("energy-sparks-crowd"),
  majorsHero: p("arena-walk"),
  playersHero: p("crowd-green"),
  pwaBackdrop: p("arena-tunnel"),
  notificationsEmpty: p("energy-sparks-crowd"),
  faqHero: p("emotion-breath"),
  joinHero: p("crowd-hands"),
  errorHero: p("emotion-despair"),
  revealStage: p("emotion-scream"),
  revealPlayoffs: p("energy-trophy-crowd"),
  singaporeMajor: p("arena-red"),
} as const;

/** The /info page's five chapter cards, in order. */
export const INFO_PHOTOS = [
  p("energy-sparkler-walk"),
  p("crowd-jump"),
  p("emotion-kiss"),
  p("emotion-disbelief"),
  p("energy-flag-brazil"),
] as const;

/** Behind the leaderboard podium cards: 1st, 2nd, 3rd. */
export const PODIUM_PHOTOS = [p("energy-trophy-lift"), p("emotion-joy"), p("emotion-applause")] as const;

/** Profile heroes rotate through crowd and walkout shots, one per player. */
const PROFILE_POOL = [
  p("crowd-jump"),
  p("crowd-haze"),
  p("crowd-stairs"),
  p("crowd-walkout-red"),
  p("crowd-banner"),
  p("energy-sparks"),
  p("energy-cryo"),
  p("energy-flag-turkey"),
  p("energy-pyro"),
  p("energy-fist"),
  p("arena-floor"),
  p("emotion-embrace"),
];

/** Stand-ins for wire stories that ship without art. */
export const WIRE_FALLBACK_PHOTOS = [
  p("arena-floor"),
  p("emotion-hands-up"),
  p("crowd-haze"),
  p("emotion-cry"),
  p("energy-cryo"),
  p("emotion-dejected"),
  p("crowd-banner"),
  p("emotion-hands-head"),
] as const;

/** A stable profile hero for `seed` (the player id), so it never flickers between visits. */
export function profilePhoto(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PROFILE_POOL[Math.abs(h) % PROFILE_POOL.length];
}
