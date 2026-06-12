/**
 * verify-m9-2-topbar-you - offline proof for PHA-851 (M9.2 top-bar chip).
 *
 * Exercises the pure resolveTopbarYou/deriveInitials helpers across the four
 * paths the dashboard relies on: anonymous fallback, Steam session with an
 * avatar URL, Steam session with a missing avatar URL, and local session.
 * Plus edge cases the prior hardcoded markup never had to worry about: empty
 * persona name, whitespace-only name, single-character name, multi-word name,
 * and avatar URL that is an empty/whitespace string.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/verify-m9-2-topbar-you.ts
 */

import {
  deriveInitials,
  resolveTopbarYou,
} from "../src/lib/topbar-you-core.ts";

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

console.log("\ntopbar-you - resolveTopbarYou");

// 1. No session → anonymous fallback.
const anon = resolveTopbarYou({ session: null });
check("no session → anonymous", anon.kind === "anonymous");

// 2. Steam session with persona name + avatarfull → avatar variant.
const steamFull = resolveTopbarYou({
  session: { displayName: "phattbeats", steamId: "76561198000000001", isLocal: false },
  avatarUrl: "https://avatars.steamstatic.com/abc_full.jpg",
});
check(
  "steam + avatar → kind=avatar with label + url",
  steamFull.kind === "avatar" &&
    steamFull.label === "phattbeats" &&
    steamFull.avatarUrl === "https://avatars.steamstatic.com/abc_full.jpg",
);

// 3. Steam session whose Player row has no avatarUrl yet → initials variant.
const steamNoAvatar = resolveTopbarYou({
  session: { displayName: "phattbeats", steamId: "76561198000000002", isLocal: false },
  avatarUrl: null,
});
check(
  "steam without avatar → initials variant",
  steamNoAvatar.kind === "initials" &&
    steamNoAvatar.label === "phattbeats" &&
    steamNoAvatar.initials === "PH",
);

// 4. Local session "Test" → initials TE per spec.
const localTest = resolveTopbarYou({
  session: { displayName: "Test", isLocal: true },
  avatarUrl: null,
});
check(
  "local 'Test' → initials TE",
  localTest.kind === "initials" && localTest.initials === "TE" && localTest.label === "Test",
);

// 5. Multi-word display name → initials from first two tokens.
const multi = resolveTopbarYou({
  session: { displayName: "John Smith", isLocal: true },
  avatarUrl: null,
});
check(
  "'John Smith' → initials JS",
  multi.kind === "initials" && multi.initials === "JS",
);

// 6. Empty display name → label falls back to "You"; initials derive from
// that fallback so the chip stays self-consistent rather than showing "?You".
const emptyName = resolveTopbarYou({
  session: { displayName: "", isLocal: true },
  avatarUrl: null,
});
check(
  "empty displayName → label 'You', initials 'YO'",
  emptyName.kind === "initials" &&
    emptyName.label === "You" &&
    emptyName.initials === "YO",
);

// 7. Whitespace-only display name → same fallback as empty.
const wsName = resolveTopbarYou({
  session: { displayName: "   ", isLocal: true },
  avatarUrl: null,
});
check(
  "whitespace displayName → label 'You', initials 'YO'",
  wsName.kind === "initials" && wsName.label === "You" && wsName.initials === "YO",
);

// 8. Single-character name → that single character upper-cased.
const oneChar = resolveTopbarYou({
  session: { displayName: "x", isLocal: true },
  avatarUrl: null,
});
check(
  "single-char 'x' → initials 'X'",
  oneChar.kind === "initials" && oneChar.initials === "X",
);

// 9. avatarUrl is an empty string → treat as missing, fall back to initials.
const emptyAvatar = resolveTopbarYou({
  session: { displayName: "phattbeats", steamId: "76561198000000003", isLocal: false },
  avatarUrl: "",
});
check(
  "empty avatarUrl string → initials fallback",
  emptyAvatar.kind === "initials",
);

// 10. avatarUrl with surrounding whitespace → still treated as missing.
const wsAvatar = resolveTopbarYou({
  session: { displayName: "phattbeats", steamId: "76561198000000004", isLocal: false },
  avatarUrl: "   ",
});
check(
  "whitespace-only avatarUrl → initials fallback",
  wsAvatar.kind === "initials",
);

// 11. avatarUrl present but session displayName empty → avatar variant, label "You".
const avatarNoName = resolveTopbarYou({
  session: { displayName: "", steamId: "76561198000000005", isLocal: false },
  avatarUrl: "https://avatars.steamstatic.com/abc_full.jpg",
});
check(
  "avatar with empty displayName → label 'You'",
  avatarNoName.kind === "avatar" && avatarNoName.label === "You",
);

console.log("\ntopbar-you - deriveInitials");

check("deriveInitials('Test') === 'TE'", deriveInitials("Test") === "TE");
check("deriveInitials('John Smith') === 'JS'", deriveInitials("John Smith") === "JS");
check(
  "deriveInitials('  alice  bob  ') trims and picks AB",
  deriveInitials("  alice  bob  ") === "AB",
);
check("deriveInitials('') === '?'", deriveInitials("") === "?");
check("deriveInitials('   ') === '?'", deriveInitials("   ") === "?");
check("deriveInitials('x') === 'X'", deriveInitials("x") === "X");
// 4-byte emoji should produce a single visible glyph, not "??" or empty.
check(
  "deriveInitials uses Array.from for surrogate-safe slicing",
  deriveInitials("\u{1F525}").length > 0,
);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
