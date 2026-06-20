/**
 * verify-analytics — offline proof for the built-in pageview counter (PHA-1277).
 *
 * The collector stores only what analytics-core lets through, so these rules ARE
 * the privacy guarantee:
 *   1. device buckets are coarse (mobile / tablet / desktop), tablet before phone.
 *   2. paths are internal-only, query/hash stripped, trailing slash normalized.
 *   3. referrers reduce to an external host or null (direct / internal nav).
 *
 * Pure module, no DB. Run: node scripts/verify-analytics.ts
 */

import {
  deviceClass,
  sanitizePath,
  sanitizeReferrer,
} from "../src/lib/analytics-core.ts";

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

// 1. device classification
check("iphone → mobile", deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile") === "mobile");
check("android phone → mobile", deviceClass("Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit Mobile Safari") === "mobile");
check("ipad → tablet", deviceClass("Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit Safari") === "tablet");
check("android tablet (no 'mobile') → tablet", deviceClass("Mozilla/5.0 (Linux; Android 14; Tab) AppleWebKit Safari") === "tablet");
check("windows desktop → desktop", deviceClass("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome Safari") === "desktop");
check("empty UA → desktop", deviceClass("") === "desktop");
check("null UA → desktop", deviceClass(null) === "desktop");

// 2. path sanitization
check("plain path kept", sanitizePath("/faq") === "/faq");
check("query stripped", sanitizePath("/players?id=secret") === "/players");
check("hash stripped", sanitizePath("/settings#privacy") === "/settings");
check("trailing slash normalized", sanitizePath("/faq/") === "/faq");
check("root kept", sanitizePath("/") === "/");
check("double slash collapsed", sanitizePath("//help//auth-code") === "/help/auth-code");
check("absolute URL rejected", sanitizePath("https://evil.example/faq") === null);
check("relative rejected", sanitizePath("faq") === null);
check("non-string rejected", sanitizePath(42) === null);
check("over-long capped to 256", (sanitizePath("/" + "a".repeat(400)) ?? "").length === 256);

// 3. referrer reduction
check("external host kept", sanitizeReferrer("https://www.google.com/search?q=x") === "www.google.com");
check("internal nav → null", sanitizeReferrer("https://pickems.phatt.vip/picks") === null);
check("empty → null", sanitizeReferrer("") === null);
check("garbage → null", sanitizeReferrer("not a url") === null);
check("non-string → null", sanitizeReferrer(123) === null);
check("only host, never path", sanitizeReferrer("https://t.co/abc/secret") === "t.co");

console.log(`\nverify-analytics: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
