/**
 * verify-announcements — offline proof for the PHA-1211 broadcast announcements
 * (announcements-core).
 *
 *   1. activeAnnouncements only returns entries inside their publish→expiry
 *      window (no backfill before publish, gone after expiry).
 *   2. latestActiveAnnouncement returns the newest active one (drives the popup).
 *   3. announcementEntries produce universal-feed entries, isNew vs the seen
 *      watermark, with a stable id + the announcement href.
 *   4. the shipped ANNOUNCEMENTS list is well-formed (valid dates, start<expiry).
 *
 * Pure module, no DB. Run: node scripts/verify-announcements.ts
 */

import {
  ANNOUNCEMENTS,
  activeAnnouncements,
  latestActiveAnnouncement,
  announcementEntries,
} from "../src/lib/announcements-core.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.error("  FAIL  " + name); }
}

// The shipped "compare-surprise" window: 2026-06-18T03:00Z → 2026-06-22T00:00Z.
const PUB = Date.parse("2026-06-18T03:00:00Z");
const DURING = PUB + 6 * 3_600_000;
const BEFORE = PUB - 6 * 3_600_000;
const AFTER = Date.parse("2026-06-23T00:00:00Z");

check("shipped list is non-empty", ANNOUNCEMENTS.length >= 1);
check("every announcement has valid start < expiry", ANNOUNCEMENTS.every((a) => {
  const s = Date.parse(a.publishedAt), e = Date.parse(a.expiresAt);
  return Number.isFinite(s) && Number.isFinite(e) && s < e && !!a.id && !!a.href;
}));

check("active during window", activeAnnouncements(DURING).some((a) => a.id === "compare-surprise"));
check("not active before publish (no backfill)", activeAnnouncements(BEFORE).every((a) => a.id !== "compare-surprise"));
check("not active after expiry", activeAnnouncements(AFTER).every((a) => a.id !== "compare-surprise"));

const latest = latestActiveAnnouncement(DURING);
check("latestActive returns the live one", latest?.id === "compare-surprise");
check("latestActive null before publish", latestActiveAnnouncement(BEFORE) === null);

const fresh = announcementEntries(DURING, PUB - 1000);
check("entry built for active announcement", fresh.some((e) => e.id === "announce:compare-surprise" && e.kind === "announcement"));
check("entry isNew when published after seen", fresh.find((e) => e.id === "announce:compare-surprise")?.isNew === true);
check("entry carries the href", fresh.find((e) => e.id === "announce:compare-surprise")?.href === "/leaderboard/compare");

const seen = announcementEntries(DURING, DURING + 1000);
check("entry read when seen after publish", seen.find((e) => e.id === "announce:compare-surprise")?.isNew === false);

check("no entries outside window", announcementEntries(AFTER, 0).length === 0);

console.log(`\nverify-announcements: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
