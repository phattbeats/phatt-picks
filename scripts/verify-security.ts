/**
 * verify-security — offline proof for PHA-1045 (security hardening from the
 * PHA-1015 audit). Exercises the pure core behind three route fixes:
 *
 *   1. CSRF origin guard   (logout POST + mutating routes)
 *   2. trusted-proxy client IP (per-IP account cap can't be spoofed via XFF)
 *   3. per-key cooldown     (push-test amplifier rate limit)
 *
 * Run: node scripts/verify-security.ts
 */

import {
  parseAllowedOrigins,
  isAllowedOrigin,
  clientIpFromForwarded,
  createCooldownStore,
  checkCooldown,
  clearCooldown,
} from "../src/lib/security-core.ts";

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

console.log("\nsecurity-core - allowed origins");
check(
  "full URL normalized to origin",
  JSON.stringify(parseAllowedOrigins("https://phatt.tech/profile")) ===
    JSON.stringify(["https://phatt.tech"]),
);
check(
  "dedupes equal origins",
  JSON.stringify(
    parseAllowedOrigins("https://phatt.tech", "https://phatt.tech/x"),
  ) === JSON.stringify(["https://phatt.tech"]),
);
check(
  "drops falsy candidates",
  JSON.stringify(parseAllowedOrigins(undefined, null, "")) === JSON.stringify([]),
);

console.log("\nsecurity-core - CSRF origin guard");
const ALLOWED = ["https://phatt.tech"];
check(
  "same-origin POST allowed",
  isAllowedOrigin("https://phatt.tech", null, ALLOWED) === true,
);
check(
  "cross-site origin rejected",
  isAllowedOrigin("https://evil.example", null, ALLOWED) === false,
);
check(
  "absent origin AND referer allowed (iOS WebKit same-origin form POST — PHA-1225)",
  isAllowedOrigin(null, null, ALLOWED) === true,
);
check(
  "literal 'null' origin rejected (opaque origin IS a present header, fail closed)",
  isAllowedOrigin("null", null, ALLOWED) === false,
);
check(
  "opaque 'null' origin still rejected even when referer is absent",
  isAllowedOrigin("null", null, ALLOWED) === false,
);
check(
  "foreign origin with absent referer still rejected",
  isAllowedOrigin("https://evil.example", null, ALLOWED) === false,
);
check(
  "falls back to same-origin referer when origin absent",
  isAllowedOrigin(null, "https://phatt.tech/profile", ALLOWED) === true,
);
check(
  "cross-site referer rejected",
  isAllowedOrigin(null, "https://evil.example/x", ALLOWED) === false,
);
check(
  "no configured origins → no-op (dev) allows",
  isAllowedOrigin(null, null, []) === true,
);

console.log("\nsecurity-core - trusted-proxy client IP");
// One trusted proxy: real client is the right-most entry, NOT the spoofable left.
check(
  "1 hop takes right-most (real) entry, not spoofed left",
  clientIpFromForwarded("1.2.3.4, 9.9.9.9", null, 1) === "9.9.9.9",
);
check(
  "single-entry XFF returns that entry",
  clientIpFromForwarded("9.9.9.9", null, 1) === "9.9.9.9",
);
check(
  "2 hops reaches one further left",
  clientIpFromForwarded("8.8.8.8, 1.2.3.4, 9.9.9.9", null, 2) === "1.2.3.4",
);
check(
  "hops beyond chain length clamps to left-most",
  clientIpFromForwarded("1.2.3.4, 9.9.9.9", null, 9) === "1.2.3.4",
);
check(
  "0 hops ignores XFF, falls back to x-real-ip",
  clientIpFromForwarded("1.2.3.4", "5.5.5.5", 0) === "5.5.5.5",
);
check(
  "no XFF falls back to x-real-ip",
  clientIpFromForwarded(null, "5.5.5.5", 1) === "5.5.5.5",
);
check(
  "no XFF and no x-real-ip → null",
  clientIpFromForwarded(null, null, 1) === null,
);
check(
  "whitespace-only entries skipped",
  clientIpFromForwarded("  ,  , 9.9.9.9", null, 1) === "9.9.9.9",
);

console.log("\nsecurity-core - per-key cooldown");
const store = createCooldownStore();
const COOL = 30_000;
const first = checkCooldown(store, "p1", COOL, 1_000);
check("first call allowed", first.allowed === true);
const second = checkCooldown(store, "p1", COOL, 5_000);
check("second call within window denied", second.allowed === false);
check(
  "denied call reports remaining ms",
  second.retryAfterMs === COOL - (5_000 - 1_000),
);
const third = checkCooldown(store, "p1", COOL, 5_000 + 100);
check(
  "denied call does NOT slide the window",
  third.retryAfterMs === COOL - (5_100 - 1_000),
);
const other = checkCooldown(store, "p2", COOL, 5_000);
check("different key independent", other.allowed === true);
const afterWindow = checkCooldown(store, "p1", COOL, 1_000 + COOL);
check("allowed again exactly at window edge", afterWindow.allowed === true);

// clearCooldown refunds a reserved window (no-op action → retry immediately).
const refundStore = createCooldownStore();
checkCooldown(refundStore, "p1", COOL, 1_000);
clearCooldown(refundStore, "p1");
check(
  "cleared key may act again within the window",
  checkCooldown(refundStore, "p1", COOL, 1_500).allowed === true,
);
check("clearCooldown on absent key is a no-op", (() => {
  clearCooldown(refundStore, "never-seen");
  return true;
})());

console.log(`\nsecurity: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
