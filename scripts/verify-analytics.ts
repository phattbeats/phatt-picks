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
  browserFamily,
  osFamily,
  sanitizeCountry,
  sanitizeEvent,
  sanitizeLabel,
  scrollBucket,
  sessionize,
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

// 4. browser family (specific before generic)
check("edge → edge", browserFamily("Mozilla/5.0 Chrome/126 Safari Edg/126") === "edge");
check("samsung → samsung", browserFamily("Mozilla/5.0 Chrome SamsungBrowser/23") === "samsung");
check("opera → opera", browserFamily("Mozilla/5.0 Chrome/126 OPR/110") === "opera");
check("firefox → firefox", browserFamily("Mozilla/5.0 Gecko Firefox/128") === "firefox");
check("chrome → chrome", browserFamily("Mozilla/5.0 Chrome/126 Safari/537") === "chrome");
check("safari → safari", browserFamily("Mozilla/5.0 (Macintosh) AppleWebKit Version/17 Safari/605") === "safari");
check("empty → other", browserFamily("") === "other");

// 5. OS family (iOS before macOS, Android before Linux)
check("iphone → ios", osFamily("iPhone; CPU iPhone OS 17") === "ios");
check("ipad → ios", osFamily("Mozilla/5.0 (iPad; CPU OS 17 like Mac OS X)") === "ios");
check("android → android", osFamily("Linux; Android 14; Pixel") === "android");
check("windows → windows", osFamily("Windows NT 10.0; Win64; x64") === "windows");
check("mac → macos", osFamily("Macintosh; Intel Mac OS X 10_15") === "macos");
check("linux → linux", osFamily("X11; Linux x86_64") === "linux");

// 6. country sanitization
check("valid country upper", sanitizeCountry("us") === "US");
check("XX rejected", sanitizeCountry("XX") === null);
check("T1 (tor) rejected", sanitizeCountry("T1") === null);
check("non-2-letter rejected", sanitizeCountry("USA") === null);
check("non-string country → null", sanitizeCountry(1) === null);

// 7. event + label sanitization
check("event slug kept", sanitizeEvent("disclosure_open") === "disclosure_open");
check("event uppercased→lower", sanitizeEvent("Scroll") === "scroll");
check("event with space rejected", sanitizeEvent("bad name") === null);
check("event too long rejected", sanitizeEvent("a".repeat(50)) === null);
check("label collapses whitespace+caps", sanitizeLabel("  Big   FAQ\n\ttitle  ") === "Big FAQ title");
check("label too long capped to 80", (sanitizeLabel("x".repeat(200)) ?? "").length === 80);
check("empty label → null", sanitizeLabel("   ") === null);

// 8. scroll bucket
check("90 → 75", scrollBucket(90) === 75);
check("100 → 100", scrollBucket(100) === 100);
check("120 clamps to 100", scrollBucket(120) === 100);
check("10 → null (sub-25)", scrollBucket(10) === null);
check("50 → 50", scrollBucket(50) === 50);

// 9. sessionize: visitor grouping, gap split, bounce, entry/exit
const t0 = new Date("2026-06-20T10:00:00Z");
const mk = (visitor: string | null, path: string, mins: number) => ({ visitor, path, createdAt: new Date(t0.getTime() + mins * 60000) });
const sess = sessionize([
  mk("a", "/", 0), mk("a", "/faq", 5), mk("a", "/players", 10), // one session, 3 views
  mk("a", "/", 100),                                            // >30min gap → new session (bounce)
  mk("b", "/picks", 2),                                         // single view (bounce)
  mk(null, "/x", 3),                                            // null visitor ignored
]);
check("sessionize ignores null visitor", sess.every((s) => s.visitor !== null));
check("sessionize splits on >30m gap (a has 2 sessions)", sess.filter((s) => s.visitor === "a").length === 2);
check("sessionize counts views in a session", !!sess.find((s) => s.visitor === "a" && s.views === 3));
const aFirst = sess.find((s) => s.visitor === "a" && s.views === 3)!;
check("sessionize entry/exit paths", aFirst.entryPath === "/" && aFirst.exitPath === "/players");
check("sessionize bounce = single-view sessions", sess.filter((s) => s.views === 1).length === 2);

console.log(`\nverify-analytics: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
