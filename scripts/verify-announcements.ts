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

// The teaser "compare-surprise" publishes 2026-06-18T03:00Z and now hands off to
// "reactions-live" AT the playoff lock (first QF, 2026-06-18T13:45Z), which then
// runs to 2026-06-22T00:00Z (PHA-1245 follow-up).
const PUB = Date.parse("2026-06-18T03:00:00Z");
const LOCK = Date.parse("2026-06-18T13:45:00Z"); // bracket lock = reactions unlock
const DURING = PUB + 6 * 3_600_000;              // 09:00Z — teaser phase (before lock)
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

// ── Teaser → "reactions are live" flip at the playoff lock (PHA-1245) ──
check("before lock: only the teaser is active",
  activeAnnouncements(LOCK - 60_000).map((a) => a.id).join(",") === "compare-surprise");
check("at/after lock: teaser is gone, 'reactions-live' is active",
  activeAnnouncements(LOCK).map((a) => a.id).join(",") === "reactions-live");
check("the live one reads 'Reactions are live'",
  latestActiveAnnouncement(LOCK)?.title === "Reactions are live");
check("teaser and live windows abut exactly (no gap / no overlap)", (() => {
  const teaser = ANNOUNCEMENTS.find((a) => a.id === "compare-surprise");
  const live = ANNOUNCEMENTS.find((a) => a.id === "reactions-live");
  return !!teaser && !!live && teaser.expiresAt === live.publishedAt;
})());
check("both phases point at the Compare page",
  ANNOUNCEMENTS.filter((a) => a.id === "compare-surprise" || a.id === "reactions-live")
    .every((a) => a.href === "/leaderboard/compare"));

// announcementEntries(nowMs) → feed entries (read state is applied later by the API).
const fresh = announcementEntries(DURING);
const teaserEntry = fresh.find((e) => e.id === "announce:compare-surprise");
check("entry built for active announcement", teaserEntry?.kind === "announcement");
check("entry carries the href + publish instant", teaserEntry?.href === "/leaderboard/compare" && teaserEntry?.atMs === PUB);
check("post-lock feed surfaces the 'reactions-live' entry",
  announcementEntries(LOCK).some((e) => e.id === "announce:reactions-live"));

check("no entries outside any window", announcementEntries(AFTER).length === 0);

console.log(`\nverify-announcements: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
