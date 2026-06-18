/**
 * verify-notifications — offline proof for the PHA-1211 universal notification
 * feed (notifications-core).
 *
 *   1. reactionEntries group inbound reactions by pick, tally stamps, resolve the
 *      team/stage label, and flag isNew vs the seen watermark.
 *   2. stageLockEntry surfaces only FUTURE locks inside the lead window — a
 *      passed lock or one too far out yields null (no backfill).
 *   3. recapEntry surfaces a recent resolved stage; one older than maxAge is
 *      dropped (no backfill).
 *   4. assembleFeed counts unread = entries newer than the watermark and sorts
 *      unread-first then most-recent.
 *   5. unknown stampIds are dropped, never counted.
 *
 * Pure module, no DB. Run: node scripts/verify-notifications.ts
 */

import {
  reactionEntries,
  stageLockEntry,
  recapEntry,
  assembleFeed,
  type NotifReaction,
  type PickLabeller,
} from "../src/lib/notifications-core.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.error("  FAIL  " + name); }
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_000_000_000_000;
const SEEN = NOW - 2 * DAY;

const label: PickLabeller = (sectionId) => ({
  teamName: sectionId === 108 ? "Team Spirit" : "FaZe",
  stageLabel: sectionId === 108 ? "Quarterfinals" : "Stage I",
});

// ── reactions ──
const rows: NotifReaction[] = [
  { stampId: "fire", sectionId: 108, groupId: 276, slotIndex: 0, createdAtMs: NOW - DAY },     // new
  { stampId: "fire", sectionId: 108, groupId: 276, slotIndex: 0, createdAtMs: NOW - 3 * DAY }, // old
  { stampId: "ice", sectionId: 108, groupId: 276, slotIndex: 0, createdAtMs: NOW - 5 * DAY },  // old
];
const rEntries = reactionEntries(rows, SEEN, label);
check("one reaction entry per pick", rEntries.length === 1);
check("reaction entry resolves team name", rEntries[0].title === "Team Spirit");
check("reaction stamps tallied (fire=2)", rEntries[0].stamps?.find((s) => s.id === "fire")?.count === 2);
check("reaction body counts all 3", rEntries[0].body.includes("3 reactions"));
check("reaction isNew when a reaction is newer than seen", rEntries[0].isNew === true);
check("reaction kind is reaction", rEntries[0].kind === "reaction");

const allOld = reactionEntries(
  [{ stampId: "fire", sectionId: 108, groupId: 276, slotIndex: 0, createdAtMs: SEEN - DAY }],
  SEEN, label,
);
check("reaction read when all older than seen", allOld[0].isNew === false);

const ghost = reactionEntries(
  [...rows, { stampId: "zzz", sectionId: 108, groupId: 276, slotIndex: 0, createdAtMs: NOW }],
  SEEN, label,
);
check("unknown stamp dropped from tally", ghost[0].stamps?.every((s) => s.id !== "zzz") ?? false);

// ── stage locks ──
const futureLock = stageLockEntry({ sectionId: 107, stageName: "Stage III", lockAtMs: NOW + 6 * HOUR }, NOW, SEEN);
check("future lock within window → entry", futureLock !== null && futureLock.kind === "stage");
check("future lock body has eta", !!futureLock && /lock in/.test(futureLock.body));
check("future lock is new (appeared after seen)", futureLock?.isNew === true);
check("passed lock → null (no backfill)", stageLockEntry({ sectionId: 105, stageName: "Stage I", lockAtMs: NOW - DAY }, NOW, SEEN) === null);
check("lock too far out → null", stageLockEntry({ sectionId: 106, stageName: "Stage II", lockAtMs: NOW + 30 * DAY }, NOW, SEEN) === null);

// ── recap ──
const recentRecap = recapEntry({ sectionId: 107, stageName: "Stage III", resolvedAtMs: NOW - DAY }, NOW, SEEN);
check("recent recap → entry", recentRecap !== null && recentRecap.kind === "recap");
check("recent recap is new", recentRecap?.isNew === true);
check("stale recap → null (no backfill)", recapEntry({ sectionId: 105, stageName: "Stage I", resolvedAtMs: NOW - 30 * DAY }, NOW, SEEN) === null);

// ── assembly ──
const feed = assembleFeed([
  ...rEntries,
  ...(futureLock ? [futureLock] : []),
  ...(recentRecap ? [recentRecap] : []),
]);
check("unread counts the 3 new entries", feed.unread === 3);
check("all three kinds present", new Set(feed.items.map((i) => i.kind)).size === 3);
check("unread entries sort before read ones", feed.items[0].isNew === true);
check("limit caps the feed", assembleFeed(
  Array.from({ length: 10 }, (_, i) => ({ id: "x" + i, kind: "stage" as const, icon: "⏰", title: "t", body: "b", href: "/", atMs: i, isNew: false })),
  4,
).items.length === 4);
check("empty → caught up", assembleFeed([]).unread === 0 && assembleFeed([]).items.length === 0);

console.log(`\nverify-notifications: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
