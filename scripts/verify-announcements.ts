/**
 * verify-announcements — offline proof for the #1211 broadcast announcements
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
import { EVENTS } from "../src/lib/events-core.ts";
import { derivePlayoffLocks } from "../src/lib/lock-schedule-core.ts";

const CG = EVENTS[26]; // Cologne: these June windows are its bracket's

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.error("  FAIL  " + name); }
}

// The teaser "compare-surprise" publishes 12h before the playoff lock and hands
// off to "reactions-live" AT it (Cologne's first QF, 2026-06-18T13:45Z), which
// then runs to the UTC midnight after the GF, 2026-06-22T00:00Z (#1245, PHA-5275).
const LOCK = Date.parse("2026-06-18T13:45:00Z"); // bracket lock = reactions unlock
const PUB = LOCK - 12 * 3_600_000;
const DURING = PUB + 6 * 3_600_000;              // 09:00Z — teaser phase (before lock)
const BEFORE = PUB - 6 * 3_600_000;
const AFTER = Date.parse("2026-06-23T00:00:00Z");

check("shipped list is non-empty", ANNOUNCEMENTS.length >= 1);
// #1327: ANNOUNCEMENTS is now a template — the "reactions live" instant is a
// placeholder resolved per-call (via reactionsLiveAt) against the active event's
// registry config, not a module-load-bound constant. Assert well-formedness on
// the RESOLVED view (activeAnnouncements at a moment every entry is live).
const resolvedAll = [...activeAnnouncements(DURING, CG), ...activeAnnouncements(LOCK + 60_000, CG)];
check("every announcement has valid start < expiry", resolvedAll.every((a) => {
  const s = Date.parse(a.publishedAt), e = Date.parse(a.expiresAt);
  return Number.isFinite(s) && Number.isFinite(e) && s < e && !!a.id && !!a.href;
}));

check("active during window", activeAnnouncements(DURING, CG).some((a) => a.id === "compare-surprise"));
check("not active before publish (no backfill)", activeAnnouncements(BEFORE, CG).every((a) => a.id !== "compare-surprise"));
check("not active after expiry", activeAnnouncements(AFTER, CG).every((a) => a.id !== "compare-surprise"));

const latest = latestActiveAnnouncement(DURING, CG);
check("latestActive returns the live one", latest?.id === "compare-surprise");
check("latestActive null before publish", latestActiveAnnouncement(BEFORE, CG) === null);

// ── Teaser → "reactions are live" flip at the playoff lock (#1245) ──
check("before lock: only the teaser is active",
  activeAnnouncements(LOCK - 60_000, CG).map((a) => a.id).join(",") === "compare-surprise");
check("at/after lock: teaser is gone, 'reactions-live' is active",
  activeAnnouncements(LOCK, CG).map((a) => a.id).join(",") === "reactions-live");
check("the live one reads 'Reactions are live'",
  latestActiveAnnouncement(LOCK, CG)?.title === "Reactions are live");
check("teaser and live windows abut exactly (no gap / no overlap)", (() => {
  const teaser = ANNOUNCEMENTS.find((a) => a.id === "compare-surprise");
  const live = ANNOUNCEMENTS.find((a) => a.id === "reactions-live");
  return !!teaser && !!live && teaser.expiresAt === live.publishedAt;
})());
check("both phases point at the Compare page",
  ANNOUNCEMENTS.filter((a) => a.id === "compare-surprise" || a.id === "reactions-live")
    .every((a) => a.href === "/leaderboard/compare"));

// announcementEntries(nowMs, event) → feed entries (read state is applied later by the API).
const fresh = announcementEntries(DURING, CG);
const teaserEntry = fresh.find((e) => e.id === "announce:compare-surprise");
check("entry built for active announcement", teaserEntry?.kind === "announcement");
check("entry carries the href + publish instant", teaserEntry?.href === "/leaderboard/compare" && teaserEntry?.atMs === PUB);
check("post-lock feed surfaces the 'reactions-live' entry",
  announcementEntries(LOCK, CG).some((e) => e.id === "announce:reactions-live"));

check("no entries outside any window", announcementEntries(AFTER, CG).length === 0);
check("reactions-live runs to the midnight after Cologne's GF",
  activeAnnouncements(Date.parse("2026-06-21T23:59:00Z"), CG).some((a) => a.id === "reactions-live") &&
  activeAnnouncements(Date.parse("2026-06-22T00:00:00Z"), CG).every((a) => a.id !== "reactions-live"));
// PHA-5275: an unscheduled bracket gets no Cologne-dated reactions broadcast
// (the old fallback was Cologne's QF time). Singapore's bracket has been dated
// since PHA-5276, so this runs on an undated copy of it.
{
  const undatedLocks = Object.fromEntries(
    Object.entries(EVENTS[27].lockSchedule).filter(([k]) => !["114", "115", "116"].includes(k)),
  );
  const undated = { ...EVENTS[27], playoffSchedule: {}, lockSchedule: undatedLocks };
  check("no reactions broadcast while a bracket is unscheduled",
    activeAnnouncements(Date.parse("2026-12-10T12:00:00Z"), undated).every((a) => a.id !== "reactions-live" && a.id !== "compare-surprise"));
  check("Singapore's dated bracket gets 'reactions-live' after its first QF",
    activeAnnouncements(Date.parse("2026-12-10T12:00:00Z"), EVENTS[27]).some((a) => a.id === "reactions-live"));
}
{
  // A Singapore-shaped event with its bracket published: windows follow ITS times.
  const sched = { 114: ["2026-12-10T03:00:00Z", "2026-12-10T06:30:00Z", "2026-12-11T03:00:00Z", "2026-12-11T06:30:00Z"], 115: ["2026-12-12T03:00:00Z", "2026-12-12T06:30:00Z"], 116: ["2026-12-13T05:00:00Z"] };
  const sg = { ...EVENTS[27], playoffSchedule: sched, lockSchedule: { ...EVENTS[27].lockSchedule, ...derivePlayoffLocks(sched) } };
  const sgLock = Date.parse("2026-12-10T03:00:00Z");
  check("Singapore teaser runs the 12h before its first QF",
    activeAnnouncements(sgLock - 60_000, sg).map((a) => a.id).join(",") === "compare-surprise" &&
    activeAnnouncements(sgLock - 13 * 3_600_000, sg).length === 0);
  check("Singapore reactions go live at its first QF and end the midnight after its GF",
    activeAnnouncements(sgLock, sg).map((a) => a.id).join(",") === "reactions-live" &&
    activeAnnouncements(Date.parse("2026-12-13T23:59:00Z"), sg).some((a) => a.id === "reactions-live") &&
    activeAnnouncements(Date.parse("2026-12-14T00:00:00Z"), sg).every((a) => a.id !== "reactions-live"));
}

console.log(`\nverify-announcements: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
