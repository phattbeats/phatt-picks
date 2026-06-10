/**
 * verify-session — offline proof for PHA-982 (sliding sessions + secret guard).
 *
 * Brandon: "every time the container resets I have to log in again, especially
 * Steam." Two root mechanics, both proven here against the PURE policy core:
 *
 *   1. Lifetime drift. Steam cookies were minted at 7d and never refreshed
 *      while local cookies were 30d — so Steam users (2FA on every re-login)
 *      were forced back roughly weekly. We now mint ONE 30d lifetime for all
 *      and slide-refresh active sessions, so continued use never expires.
 *
 *   2. Secret rotation. A missing/placeholder NEXTAUTH_SECRET invalidates every
 *      existing cookie (= mass logout). isPlaceholderSecret catches it at boot.
 *
 * Run: node scripts/verify-session.ts
 */

import {
  SESSION_TTL_SECONDS,
  shouldRefreshSession,
  isPlaceholderSecret,
  sessionCookieOptions,
  signSessionToken,
  verifySessionToken,
} from "../src/lib/session-core.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name);
  }
}

console.log("\nsession-core - sliding refresh (PHA-982)");

const NOW = 1_800_000_000; // fixed clock (seconds) — deterministic
const TTL = SESSION_TTL_SECONDS;

// Fresh token (just minted): exp = now + 30d, well over halfway → no refresh.
check(
  "fresh 30d token does NOT refresh",
  shouldRefreshSession({ exp: NOW + TTL }, NOW) === false,
);
// Exactly at the halfway boundary (remaining == TTL/2) → not yet (strict <).
check(
  "at halfway boundary does NOT refresh",
  shouldRefreshSession({ exp: NOW + TTL / 2 }, NOW) === false,
);
// One second past halfway → refresh (re-stamp the active user).
check(
  "just past halfway refreshes",
  shouldRefreshSession({ exp: NOW + TTL / 2 - 1 }, NOW) === true,
);
// Almost expired → refresh.
check(
  "nearly-expired token refreshes",
  shouldRefreshSession({ exp: NOW + 60 }, NOW) === true,
);
// Already expired (negative remaining) → refresh decision is still true; the
// signature/exp check upstream is what actually rejects a dead token.
check(
  "expired token returns refresh=true",
  shouldRefreshSession({ exp: NOW - 1 }, NOW) === true,
);
// Missing / non-numeric exp → treat as refresh (re-mint a sane lifetime).
check(
  "missing exp returns refresh=true",
  shouldRefreshSession({}, NOW) === true,
);

console.log("\nsession-core - secret guard (PHA-982)");

check("undefined secret is placeholder", isPlaceholderSecret(undefined) === true);
check("empty secret is placeholder", isPlaceholderSecret("") === true);
check("whitespace secret is placeholder", isPlaceholderSecret("   ") === true);
check("short secret is placeholder", isPlaceholderSecret("abc123") === true);
check(
  "known dev value is placeholder",
  isPlaceholderSecret("dev-only-not-committed") === true,
);
check(
  "smoke-test value is placeholder",
  isPlaceholderSecret("smoke-test-secret-not-real") === true,
);
check(
  "REPLACE_ME is placeholder (case-insensitive)",
  isPlaceholderSecret("REPLACE_ME") === true,
);
check(
  "real base64-32 secret is NOT a placeholder",
  isPlaceholderSecret("1Dt2RxAbCdEfGhIjKlMnOpQrStUvWxYz0123456789Jho=") === false,
);

console.log("\nsession-core - cookie options (PHA-982)");

const prod = sessionCookieOptions(true);
const dev = sessionCookieOptions(false);
check("prod cookie is secure", prod.secure === true);
check("dev cookie is not secure", dev.secure === false);
check("cookie is httpOnly", prod.httpOnly === true);
check("cookie sameSite is lax", prod.sameSite === "lax");
check("cookie maxAge is 30d", prod.maxAge === 60 * 60 * 24 * 30);
check("cookie path is root", prod.path === "/");

console.log("\nsession-core - sign/verify round-trip (PHA-982)");

const SECRET = "test-secret-high-entropy-value-x";
// Steam claims survive the round trip…
const steamTok = await signSessionToken(
  { sub: "p1", displayName: "Brandolorian", steamId: "76561198000000000" },
  SECRET,
);
const steamPayload = await verifySessionToken(steamTok, SECRET);
check("steam token verifies", steamPayload !== null);
check("steam sub round-trips", steamPayload?.sub === "p1");
check("steam steamId round-trips", steamPayload?.steamId === "76561198000000000");
check("steam isLocal is absent", steamPayload?.isLocal === undefined);
// …and the minted lifetime is the unified 30 days (within a small skew).
const lifetime = (steamPayload?.exp as number) - (steamPayload?.iat as number);
check("minted lifetime is ~30d", Math.abs(lifetime - TTL) <= 2);

// Local claims round-trip with isLocal=true.
const localTok = await signSessionToken(
  { sub: "p2", displayName: "guest", isLocal: true },
  SECRET,
);
const localPayload = await verifySessionToken(localTok, SECRET);
check("local isLocal round-trips", localPayload?.isLocal === true);

// A token signed with a DIFFERENT secret fails verification — this is exactly
// the "secret rotated on container recreate → mass logout" case.
const rotated = await verifySessionToken(steamTok, "a-completely-different-secret-32");
check("token from old secret fails after rotation", rotated === null);

console.log(`\nsession: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
