/**
 * verify-m8-3-local-auth - offline proof for PHA-839 (local-auth dedup).
 *
 * Exercises the PURE core: the action decision (none|local|steam ->
 * create|reuse-local|preserve-steam) and the displayName sanitizer. No
 * prisma, no jose, no next runtime.
 *
 * Run: node --env-file=.env scripts/verify-m8-3-local-auth.ts
 */

import {
  ADJECTIVES,
  NOUNS,
  DISPLAY_NAME_MAX,
  decideLocalAuthAction,
  randomName,
  sanitizeDisplayName,
} from "../src/lib/local-auth-core.ts";

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

console.log("\nlocal-auth-core - action decision (PHA-839 dedup rules)");
const noneAction = decideLocalAuthAction({ kind: "none" });
check("no session -> create", noneAction.kind === "create");

const localAction = decideLocalAuthAction({ kind: "local", playerId: "p_local_1" });
check("local session -> reuse-local", localAction.kind === "reuse-local");
check(
  "reuse-local carries playerId (no new row)",
  localAction.kind === "reuse-local" && localAction.playerId === "p_local_1",
);

const steamAction = decideLocalAuthAction({ kind: "steam", playerId: "p_steam_1" });
check(
  "Steam session -> preserve-steam (do NOT overwrite)",
  steamAction.kind === "preserve-steam",
);
check(
  "preserve-steam carries playerId",
  steamAction.kind === "preserve-steam" && steamAction.playerId === "p_steam_1",
);

console.log("\nlocal-auth-core - randomName");
check("ADJECTIVES + NOUNS populated", ADJECTIVES.length > 0 && NOUNS.length > 0);
const det = (() => {
  const seq = [0, 0, 0];
  let i = 0;
  return () => seq[i++ % seq.length];
})();
const detName = randomName(det);
check(
  "deterministic rng with all-zero -> adj0+noun0+0",
  detName === ADJECTIVES[0] + NOUNS[0] + "0",
);
const samples = Array.from({ length: 10 }, () => randomName());
check("default rng produces non-empty names", samples.every((n) => n.length > 0));

console.log("\nlocal-auth-core - sanitizeDisplayName");
const FB = "Fallback123";
check("trims surrounding whitespace", sanitizeDisplayName("  phaTT  ", FB) === "phaTT");
check("collapses internal whitespace", sanitizeDisplayName("foo   bar", FB) === "foo bar");
check("accepts unicode letters", sanitizeDisplayName("Omega", FB) === "Omega");
check("accepts digits, underscore, dash, dot", sanitizeDisplayName("a_b-c.1", FB) === "a_b-c.1");
check("rejects empty -> fallback", sanitizeDisplayName("", FB) === FB);
check("rejects whitespace-only -> fallback", sanitizeDisplayName("   ", FB) === FB);
check("rejects null -> fallback", sanitizeDisplayName(null, FB) === FB);
check("rejects undefined -> fallback", sanitizeDisplayName(undefined, FB) === FB);
check("rejects non-string -> fallback", sanitizeDisplayName(123 as unknown as string, FB) === FB);
check(
  "rejects overlong -> fallback",
  sanitizeDisplayName("a".repeat(DISPLAY_NAME_MAX + 1), FB) === FB,
);
check(
  "accepts exactly DISPLAY_NAME_MAX",
  sanitizeDisplayName("a".repeat(DISPLAY_NAME_MAX), FB) === "a".repeat(DISPLAY_NAME_MAX),
);
check("rejects HTML tags -> fallback", sanitizeDisplayName("<script>", FB) === FB);
check("rejects control char -> fallback", sanitizeDisplayName("foo\x01bar", FB) === FB);
check("rejects symbol chars like @ -> fallback", sanitizeDisplayName("foo@bar", FB) === FB);
check("collapses newline into single space (still valid)", sanitizeDisplayName("foo\nbar", FB) === "foo bar");

console.log("\nlocal-auth-core - end-to-end scenarios");
const cold = decideLocalAuthAction({ kind: "none" });
check("scenario A (cold) -> create", cold.kind === "create");

const returning = decideLocalAuthAction({ kind: "local", playerId: "p_returning" });
check("scenario B (returning local) -> reuse-local", returning.kind === "reuse-local");

const steam = decideLocalAuthAction({ kind: "steam", playerId: "p_steam_real" });
check("scenario C (Steam-authed) -> preserve-steam", steam.kind === "preserve-steam");

console.log("\n" + pass + "/" + (pass + fail) + " checks passed");
process.exit(fail === 0 ? 0 : 1);
