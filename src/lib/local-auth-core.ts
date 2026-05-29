/**
 * local-auth-core — PURE helpers for the local-player auth flow. No prisma,
 * no jose, no next runtime. Importable from the offline verify harness and
 * from any route/page that needs to make decisions about whether a visit to
 * /api/auth/local should mint a new Player or reuse the existing session.
 *
 * The split exists because PHA-839 added two real rules to that endpoint:
 *   1. A visit must not silently overwrite a Steam session with a local one.
 *   2. A visit must not mint a duplicate local Player on every refresh.
 * Both decisions are pure functions of the existing session — keeping them
 * here lets the verify script exercise them without spinning up Next.
 */

export const ADJECTIVES = [
  "Tactical",
  "Clutch",
  "Raging",
  "Silent",
  "Atomic",
  "Phantom",
  "Steel",
  "Iron",
];

export const NOUNS = [
  "Awper",
  "Rusher",
  "Lurker",
  "Baiter",
  "Caller",
  "Fragger",
  "Entry",
  "Support",
];

export const DISPLAY_NAME_MAX = 24;
const DISPLAY_NAME_RE = /^[\p{L}\p{N}_\-. ]+$/u;

/** Pick a fresh suggested name. `rng` defaults to Math.random for prod. */
export function randomName(rng: () => number = Math.random): string {
  const adj = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(rng() * NOUNS.length)];
  const num = Math.floor(rng() * 999);
  return `${adj}${noun}${num}`;
}

/**
 * Clean a user-submitted display name. Collapses whitespace, trims, caps to
 * DISPLAY_NAME_MAX. Returns `fallback` if the input is empty, too long after
 * trimming, or contains characters outside the allowed set (letters, digits,
 * spaces, `_-.`). The fallback exists so a bad submission still produces a
 * usable Player row rather than 400'ing the form.
 */
export function sanitizeDisplayName(
  input: string | null | undefined,
  fallback: string,
): string {
  if (typeof input !== "string") return fallback;
  const collapsed = input.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return fallback;
  if (collapsed.length > DISPLAY_NAME_MAX) return fallback;
  if (!DISPLAY_NAME_RE.test(collapsed)) return fallback;
  return collapsed;
}

export type LocalSessionView =
  | { kind: "none" }
  | { kind: "local"; playerId: string }
  | { kind: "steam"; playerId: string };

export type LocalAuthAction =
  /** No valid session — proceed to mint a new Player. */
  | { kind: "create" }
  /** Valid local session — reissue the same cookie, no DB write. */
  | { kind: "reuse-local"; playerId: string }
  /** Steam session active — DO NOT overwrite, just redirect home. */
  | { kind: "preserve-steam"; playerId: string };

/**
 * Decide what /api/auth/local should do given the caller's current session.
 * Pure: no IO. Callers handle the side-effects (cookie reissue, redirect,
 * Player.create) based on the returned kind.
 */
export function decideLocalAuthAction(session: LocalSessionView): LocalAuthAction {
  if (session.kind === "steam") {
    return { kind: "preserve-steam", playerId: session.playerId };
  }
  if (session.kind === "local") {
    return { kind: "reuse-local", playerId: session.playerId };
  }
  return { kind: "create" };
}
