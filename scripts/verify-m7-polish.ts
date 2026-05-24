/**
 * verify-m7-polish — offline proof for M7 (PWA / push / invite / onboarding).
 *
 * Run: node --env-file=.env scripts/verify-m7-polish.ts
 *
 * Imports only the PURE cores (notify-core, invite-core — no relative value
 * imports, so node's type-strip loader resolves them) plus static PWA asset
 * checks via node:fs. No network, no prisma, no live push.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  DEFAULT_REMINDER_OFFSETS_MS,
  DEFAULT_FIRE_WINDOW_MS,
  computeReminderTimes,
  dueReminders,
  buildPreLockPayload,
  humanizeLockEta,
  isReminderRecipient,
} from "../src/lib/notify-core.ts";
import {
  isValidInviteCode,
  normalizeInviteCode,
  buildInviteUrl,
} from "../src/lib/invite-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("\nnotify-core — reminder schedule");
check("default offsets are 24h + 1h", DEFAULT_REMINDER_OFFSETS_MS.length === 2 && DEFAULT_REMINDER_OFFSETS_MS[0] === DAY_MS && DEFAULT_REMINDER_OFFSETS_MS[1] === HOUR_MS);

const LOCK = Date.parse("2026-06-02T09:00:00Z");
const times = computeReminderTimes(LOCK);
check("computes 2 reminder times", times.length === 2);
check("sorted earliest first (24h before 1h)", times[0].offsetMs === DAY_MS && times[1].offsetMs === HOUR_MS);
check("fireAt = lock - offset", times[0].fireAtMs === LOCK - DAY_MS && times[1].fireAtMs === LOCK - HOUR_MS);
check("labels are 24h / 1h", times[0].label === "24h" && times[1].label === "1h");

check("24h reminder due at lock-24h", dueReminders(LOCK - DAY_MS, LOCK).some((r) => r.label === "24h"));
check("1h reminder due at lock-1h", dueReminders(LOCK - HOUR_MS, LOCK).some((r) => r.label === "1h"));
check("nothing due before first fire", dueReminders(LOCK - DAY_MS - MINUTE_MS, LOCK).length === 0);
check("nothing due after lock", dueReminders(LOCK + 1, LOCK).length === 0);
check("reminder expires after fire window", dueReminders(LOCK - DAY_MS + DEFAULT_FIRE_WINDOW_MS + 1, LOCK).length === 0);
check("reminder still due inside fire window", dueReminders(LOCK - DAY_MS + MINUTE_MS, LOCK).some((r) => r.label === "24h"));

console.log("\nnotify-core — copy + ETA");
check('humanize 1h => "1 hour"', humanizeLockEta(HOUR_MS) === "1 hour");
check('humanize 24h => "1 day"', humanizeLockEta(DAY_MS) === "1 day");
check('humanize 2h => "2 hours"', humanizeLockEta(2 * HOUR_MS) === "2 hours");
check('humanize 30m => "30 minutes"', humanizeLockEta(30 * MINUTE_MS) === "30 minutes");

const payload1h = buildPreLockPayload({ stageName: "Stage I", lockAtMs: LOCK, nowMs: LOCK - HOUR_MS });
check("payload body mentions '1 hour'", payload1h.body.includes("1 hour"));
check("payload tag is stage-keyed", payload1h.tag === "prelock-stage-i");
check("payload defaults url to /picks", payload1h.url === "/picks");

console.log("\nnotify-core — recipient gate");
check("opted-in + unlocked => recipient", isReminderRecipient({ hasSubscription: true, hasLockedStage: false }));
check("opted-in + already locked => skip", !isReminderRecipient({ hasSubscription: true, hasLockedStage: true }));
check("not opted-in => skip", !isReminderRecipient({ hasSubscription: false, hasLockedStage: false }));

console.log("\ninvite-core");
check("valid 12-hex accepted", isValidInviteCode("ab12cd34ef56"));
check("uppercase normalized + accepted", isValidInviteCode("AB12CD34EF56"));
check("11 chars rejected", !isValidInviteCode("ab12cd34ef5"));
check("non-hex rejected", !isValidInviteCode("zb12cd34ef56"));
check("null rejected", !isValidInviteCode(null));
check("normalize trims + lowercases", normalizeInviteCode("  AB12CD34EF56 ") === "ab12cd34ef56");
check("invite url strips trailing slash + lowercases code", buildInviteUrl("https://pickems.phatt.vip/", "AB12CD34EF56") === "https://pickems.phatt.vip/join/ab12cd34ef56");

console.log("\nPWA assets");
let manifest: Record<string, unknown> = {};
try {
  manifest = JSON.parse(readFileSync(join(ROOT, "public/manifest.json"), "utf8"));
} catch {
  /* check below fails */
}
check("manifest.json parses", Object.keys(manifest).length > 0);
check("manifest name set", manifest.name === "phaTT Picks");
check("manifest display = standalone", manifest.display === "standalone");
check("manifest start_url set", typeof manifest.start_url === "string" && (manifest.start_url as string).startsWith("/"));
const icons = (manifest.icons as Array<{ src: string; sizes: string; purpose?: string }>) ?? [];
check("manifest declares 192 + 512 icons", icons.some((i) => i.sizes === "192x192") && icons.some((i) => i.sizes === "512x512"));
check("manifest declares a maskable icon", icons.some((i) => i.purpose === "maskable"));

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const f of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) {
  const p = join(ROOT, "public", f);
  const ok = existsSync(p) && readFileSync(p).subarray(0, 8).equals(PNG_SIG);
  check(`${f} exists and is a PNG`, ok);
}
// Every manifest-referenced icon resolves on disk.
check("all manifest icon files exist", icons.every((i) => existsSync(join(ROOT, "public", i.src.replace(/^\//, "")))));

let sw = "";
try {
  sw = readFileSync(join(ROOT, "public/sw.js"), "utf8");
} catch {
  /* checks below fail */
}
check("sw handles install", /addEventListener\(["']install["']/.test(sw));
check("sw handles push", /addEventListener\(["']push["']/.test(sw));
check("sw handles notificationclick", /addEventListener\(["']notificationclick["']/.test(sw));
check("sw has a fetch handler (installability)", /addEventListener\(["']fetch["']/.test(sw));

console.log(`\nM7 verify: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
