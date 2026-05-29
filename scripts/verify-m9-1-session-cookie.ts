/**
 * verify-m9-1-session-cookie - offline proof for PHA-850.
 *
 * Exercises shouldUseSecureCookie(baseUrl): does the phatt_session cookie's
 * Secure attribute follow the configured NEXTAUTH_URL scheme rather than
 * NODE_ENV? Pre-PHA-850 the routes hard-coded `NODE_ENV === "production"`,
 * which silently dropped the cookie on Brandon's plain-HTTP LAN deploy.
 *
 * Run: node --env-file=.env scripts/verify-m9-1-session-cookie.ts
 */

import { shouldUseSecureCookie } from "../src/lib/session-cookie-core.ts";

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

console.log("\nsession-cookie-core - scheme-driven Secure flag (PHA-850)");

check(
  "https prod URL -> Secure",
  shouldUseSecureCookie("https://pickems.phatt.vip") === true,
);
check(
  "https with port -> Secure",
  shouldUseSecureCookie("https://pickems.phatt.vip:8443") === true,
);

check(
  "http LAN IP (Brandon's repro) -> not Secure",
  shouldUseSecureCookie("http://10.0.0.100:3005") === false,
);
check(
  "http localhost dev -> not Secure",
  shouldUseSecureCookie("http://localhost:3000") === false,
);
check(
  "http custom host -> not Secure",
  shouldUseSecureCookie("http://picks.local") === false,
);

console.log("\nsession-cookie-core - input hardening");
check("undefined -> not Secure", shouldUseSecureCookie(undefined) === false);
check("null -> not Secure", shouldUseSecureCookie(null) === false);
check("empty string -> not Secure", shouldUseSecureCookie("") === false);
check(
  "non-string -> not Secure",
  shouldUseSecureCookie(123 as unknown as string) === false,
);
check(
  "scheme-only prefix-spoof rejected",
  shouldUseSecureCookie(" https://x") === false,
);
check(
  "case mismatch (HTTPS://) rejected — NEXTAUTH_URL is always lowercase",
  shouldUseSecureCookie("HTTPS://pickems.phatt.vip") === false,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
