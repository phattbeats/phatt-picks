/**
 * verify-notifications — offline proof for the PHA-1211 Bleachers notification
 * feed (notifications-core buildNotifications).
 *
 *   1. unread = reactions strictly newer than the seenAt watermark (badge math).
 *   2. reactions group by the pick they landed on (section/group/slot); a stamp
 *      tally per group in count-desc order.
 *   3. groups with unread reactions sort above fully-read ones, then by recency.
 *   4. hasNew / newCount reflect only reactions newer than the watermark.
 *   5. unknown stampIds are dropped, never counted, never rendered.
 *   6. the limit caps the item list.
 *
 * Pure module, no DB. Run: node scripts/verify-notifications.ts
 */

import { buildNotifications, type NotifReaction } from "../src/lib/notifications-core.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.error("  FAIL  " + name); }
}

const SEEN = 1000;
// Pick A (105/271/0): fire@900 (old), fire@1200 (new), ice@1300 (new)
// Pick B (108/276/0): cope@500 (old)
const rows: NotifReaction[] = [
  { stampId: "fire", sectionId: 105, groupId: 271, slotIndex: 0, createdAtMs: 900 },
  { stampId: "fire", sectionId: 105, groupId: 271, slotIndex: 0, createdAtMs: 1200 },
  { stampId: "ice", sectionId: 105, groupId: 271, slotIndex: 0, createdAtMs: 1300 },
  { stampId: "cope", sectionId: 108, groupId: 276, slotIndex: 0, createdAtMs: 500 },
];

const v = buildNotifications(rows, SEEN);

check("unread counts only reactions newer than seenAt", v.unread === 2);
check("two pick groups", v.items.length === 2);

const a = v.items.find((i) => i.sectionId === 105)!;
const b = v.items.find((i) => i.sectionId === 108)!;
check("group A totals all its reactions", a.total === 3);
check("group A fire tally = 2", a.stamps.find((s) => s.id === "fire")?.count === 2);
check("group A stamps sorted count-desc", a.stamps[0].id === "fire" && a.stamps[0].count === 2);
check("group A hasNew + newCount=2", a.hasNew && a.newCount === 2);
check("group B is fully read", !b.hasNew && b.newCount === 0);
check("unread group sorts first", v.items[0].sectionId === 105);

// Everything seen → zero unread, groups still listed (history).
const seenAll = buildNotifications(rows, 99999);
check("watermark past all → unread 0", seenAll.unread === 0);
check("history still present when all read", seenAll.items.length === 2 && seenAll.items.every((i) => !i.hasNew));

// Unknown stamp dropped.
const withGhost = buildNotifications(
  [...rows, { stampId: "zzz", sectionId: 105, groupId: 271, slotIndex: 0, createdAtMs: 1400 }],
  SEEN,
);
check("unknown stamp not counted in unread", withGhost.unread === 2);
check("unknown stamp not in any tally", withGhost.items.every((i) => i.stamps.every((s) => s.id !== "zzz")));

// Limit caps items.
const many: NotifReaction[] = Array.from({ length: 5 }, (_, i) => ({
  stampId: "fire", sectionId: 200 + i, groupId: 1, slotIndex: 0, createdAtMs: 100 + i,
}));
check("limit caps item count", buildNotifications(many, 0, 3).items.length === 3);

// Empty.
check("no rows → empty view", buildNotifications([], 0).unread === 0 && buildNotifications([], 0).items.length === 0);

console.log(`\nverify-notifications: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
