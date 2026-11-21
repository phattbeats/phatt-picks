/**
 * Clubhouse avatars for local players (PHA-5341).
 *
 * A local player who never uploaded a photo used to render as a grey two-letter
 * box. Now each one gets a Clubhouse avatar, picked at random once and stored in
 * `Player.avatarUrl` as a path under /art/clubhouse-avatars/, and can choose a
 * different one in Settings → Identity.
 *
 * The art is the PLAIN version of each Clubhouse avatar (never foil: in the
 * Clubhouse the foil is a CSS ring + shine over the same file, and Hotline copies
 * none of that). It is vendored into public/art/clubhouse-avatars/ so Hotline
 * never depends on the Clubhouse server. Source: phattbeats/clubhouse-games,
 * client/kit/avatars.js (AVATAR_ROWS) and client/art/avatars/, at
 * {@link CLUBHOUSE_AVATARS_SOURCE_COMMIT}. The limited Shop drop
 * "Wanted: The Dealer" (`dealer-wanted`) is left out on purpose.
 *
 * Pure module: no prisma, no next. Safe to import from verify scripts.
 */

export const CLUBHOUSE_AVATARS_SOURCE_COMMIT = "5e6128ccbdc9f4219cc32f7640559877dc7c7de2";

export const CLUBHOUSE_AVATAR_SIZES = [64, 128] as const;
export type ClubhouseAvatarSize = (typeof CLUBHOUSE_AVATAR_SIZES)[number];

export interface ClubhouseAvatar {
  slug: string;
  name: string;
}

/** The pool: used for the random pick and for the picker. Order = Clubhouse catalog order. */
export const CLUBHOUSE_AVATARS: readonly ClubhouseAvatar[] = Object.freeze([
  { slug: "plnt-leaf-shield", name: "Leaf Shield" },
  { slug: "plnt-sprout-buddy", name: "Sprout Buddy" },
  { slug: "plnt-neon-wave", name: "Neon Wave Leaf" },
  { slug: "bucks-coin-stack", name: "Coin Stack" },
  { slug: "arcade-cabinet", name: "Arcade Cabinet" },
  { slug: "clubhouse-suits", name: "Suit Rose" },
  { slug: "clubhouse-dominoes", name: "Domino Topple" },
  { slug: "clubhouse-chip", name: "Clubhouse Chip" },
  { slug: "clubhouse-golf-ball", name: "Golf Ball" },
  { slug: "poker-neon-chips", name: "Neon Chips" },
  { slug: "clubhouse-dealer", name: "The Dealer" },
  { slug: "7dtz-blade-shield", name: "Blade & Shield" },
  { slug: "7dtz-blood-moon", name: "Blood Moon" },
  { slug: "cs-spray-tag", name: "Spray Tag" },
  { slug: "arcade-joystick", name: "Vapor Joystick" },
  { slug: "arcade-lodge", name: "The Lodge" },
  { slug: "phatt-picks-ticket", name: "Picks Ticket" },
  { slug: "media-club-reel", name: "Neon Reel" },
  { slug: "sexton", name: "Sexton" },
  { slug: "blender-is-down", name: "Blender Is Down" },
  { slug: "half-for-later", name: "Half for Later" },
  { slug: "misheard-names", name: "Section? Texton?" },
  { slug: "moon-billboard", name: "Moon Billboard" },
  { slug: "bmech-email", name: "Timed Out" },
  { slug: "night-owl", name: "Night Owl" },
  { slug: "hollowmere-mirrors", name: "Hall of Mirrors" },
  { slug: "kyles-truck", name: "Kyle's Truck" },
  { slug: "dont-touch-the-bat", name: "Don't Touch the Bat" },
] as ClubhouseAvatar[]);

const SLUGS = new Set(CLUBHOUSE_AVATARS.map((a) => a.slug));
const PATH_PREFIX = "/art/clubhouse-avatars/";
const PATH_RE = /^\/art\/clubhouse-avatars\/([a-z0-9-]+)-(64|128)\.webp$/;

/** True only for a slug in the pool. Anything else (unknown, foil id, a path) is false. */
export function isClubhouseAvatarSlug(slug: unknown): slug is string {
  return typeof slug === "string" && SLUGS.has(slug);
}

/** The public path for a pool slug. Throws on a slug outside the pool, so no caller can build a free-form path. */
export function clubhouseAvatarPath(slug: string, size: ClubhouseAvatarSize = 128): string {
  if (!isClubhouseAvatarSlug(slug)) throw new Error(`Not a Clubhouse avatar: ${slug}`);
  return `${PATH_PREFIX}${slug}-${size}.webp`;
}

/** The slug of a stored avatarUrl when it is one of ours, else null (an uploaded photo, a Steam picture, empty). */
export function clubhouseSlugFromUrl(url: string | null | undefined): string | null {
  const m = typeof url === "string" ? PATH_RE.exec(url) : null;
  return m && SLUGS.has(m[1]) ? m[1] : null;
}

/** A random pool slug. `rand` returns [0, 1); injectable for tests. */
export function randomClubhouseAvatarSlug(rand: () => number = Math.random): string {
  const i = Math.min(CLUBHOUSE_AVATARS.length - 1, Math.max(0, Math.floor(rand() * CLUBHOUSE_AVATARS.length)));
  return CLUBHOUSE_AVATARS[i].slug;
}

/** The stored value for a brand-new local player. */
export function randomClubhouseAvatarUrl(rand: () => number = Math.random): string {
  return clubhouseAvatarPath(randomClubhouseAvatarSlug(rand));
}

// ---- backfill ------------------------------------------------------------------------------------------------------

export interface BackfillCandidate {
  id: string;
  isLocal: boolean;
  steamId: string | null;
  avatarUrl: string | null;
}

/** Who needs one: a local player (no Steam link) whose avatarUrl is null or blank. An uploaded photo is never touched. */
export function needsClubhouseAvatar(p: BackfillCandidate): boolean {
  return p.isLocal && !p.steamId && (p.avatarUrl == null || p.avatarUrl.trim() === "");
}

/** The updates to make, one random avatar per player who needs one. Running it on its own output yields nothing. */
export function planClubhouseAvatarBackfill(
  players: readonly BackfillCandidate[],
  rand: () => number = Math.random,
): { id: string; avatarUrl: string }[] {
  return players.filter(needsClubhouseAvatar).map((p) => ({ id: p.id, avatarUrl: randomClubhouseAvatarUrl(rand) }));
}

// ---- save route ----------------------------------------------------------------------------------------------------

export type ClubhouseAvatarSaveDecision =
  | { ok: true; avatarUrl: string }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * The checks behind POST /api/avatar/clubhouse, kept pure so they can be proven offline.
 * Order: origin, session, the player row, local-only, then the slug against the pool.
 */
export function decideClubhouseAvatarSave(input: {
  sameOrigin: boolean;
  signedIn: boolean;
  player: { isLocal: boolean; steamId: string | null } | null;
  slug: unknown;
}): ClubhouseAvatarSaveDecision {
  if (!input.sameOrigin) return { ok: false, status: 403, error: "Bad origin" };
  if (!input.signedIn) return { ok: false, status: 401, error: "Not authenticated" };
  if (!input.player) return { ok: false, status: 404, error: "Player not found" };
  if (!input.player.isLocal || input.player.steamId) {
    return { ok: false, status: 403, error: "Steam players use their Steam picture" };
  }
  if (!isClubhouseAvatarSlug(input.slug)) return { ok: false, status: 400, error: "Unknown avatar" };
  return { ok: true, avatarUrl: clubhouseAvatarPath(input.slug) };
}
