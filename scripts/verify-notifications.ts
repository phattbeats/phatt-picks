/**
 * verify-notifications — offline proof for the PHA-1211 universal notification
 * feed + PHA-1237 per-notification read state.
 *
 *   1. reactionEntries group inbound reactions by pick, tally stamps, and
 *      resolve the team/stage label (no isNew — that's layered on later).
 *   2. stageLockEntry surfaces only FUTURE locks inside the lead window — a
 *      passed lock or one too far out yields null (no backfill).
 *   3. recapEntry surfaces a recent resolved stage; one older than maxAge is
 *      dropped (no backfill).
 *   4. assembleFeed + ReadContext: explicit per-entry read beats the
 *      notificationsSeenAt watermark; a re-emerging entry (atMs after the
 *      read's readAt) goes back to unread. PHA-1237.
 *   5. unknown stampIds are dropped, never counted.
 *
 * Pure module, no DB. Run: node scripts/verify-notifications.ts
 */

import {
  reactionEntries,
  stageLockEntry,
  recapEntry,
  assembleFeed,
  emptyReadContext,
  isRead,
  withReadState,
  filterEntriesByPrefs,
  parseNotifPrefs,
  DEFAULT_NOTIF_PREFS,
  type NotifReaction,
  type NotifEntry,
  type PickLabeller,
  type ReadContext,
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
  { stampId: "fire", sectionId: 108, groupId: 276, slotIndex: 0, createdAtMs: NOW - DAY },
  { stampId: "fire", sectionId: 108, groupId: 276, slotIndex: 0, createdAtMs: NOW - 3 * DAY },
  { stampId: "ice", sectionId: 108, groupId: 276, slotIndex: 0, createdAtMs: NOW - 5 * DAY },
];
const rEntries = reactionEntries(rows, label);
check("one reaction entry per pick", rEntries.length === 1);
check("reaction entry resolves team name", rEntries[0].title === "Team Spirit");
check("reaction stamps tallied (fire=2)", rEntries[0].stamps?.find((s) => s.id === "fire")?.count === 2);
check("reaction body counts all 3", rEntries[0].body.includes("3 reactions"));
check("reaction kind is reaction", rEntries[0].kind === "reaction");
// Builder output is now isNew-less (raw); the assembled form owns the flag.
check("builder leaves isNew unset", !("isNew" in rEntries[0]));

const ghost = reactionEntries(
  [...rows, { stampId: "zzz", sectionId: 108, groupId: 276, slotIndex: 0, createdAtMs: NOW }],
  label,
);
check("unknown stamp dropped from tally", ghost[0].stamps?.every((s) => s.id !== "zzz") ?? false);

// ── stage locks ──
const futureLock = stageLockEntry({ sectionId: 107, stageName: "Stage III", lockAtMs: NOW + 6 * HOUR }, NOW);
check("future lock within window → entry", futureLock !== null && futureLock.kind === "stage");
check("future lock body has eta", !!futureLock && /lock in/.test(futureLock.body));
check("passed lock → null (no backfill)", stageLockEntry({ sectionId: 105, stageName: "Stage I", lockAtMs: NOW - DAY }, NOW) === null);
check("lock too far out → null", stageLockEntry({ sectionId: 106, stageName: "Stage II", lockAtMs: NOW + 30 * DAY }, NOW) === null);

// ── recap ──
const recentRecap = recapEntry({ sectionId: 107, stageName: "Stage III", resolvedAtMs: NOW - DAY }, NOW);
check("recent recap → entry", recentRecap !== null && recentRecap.kind === "recap");
check("stale recap → null (no backfill)", recapEntry({ sectionId: 105, stageName: "Stage I", resolvedAtMs: NOW - 30 * DAY }, NOW) === null);
// PHA-1245 follow-up: recap deep-links to the stage's reveal page + force-opens
// the cinematic deck (clicking "/" did nothing once the device dismissed it).
check("recap href deep-links to the reveal page with ?wrapped=1",
  recentRecap?.href === "/reveal/107?wrapped=1");

// ── ReadContext: explicit per-entry read beats the watermark (PHA-1237) ──
const explicitReadAt = NOW - 6 * HOUR; // player marked read 6h ago
const rcExplicit: ReadContext = {
  seenAtMs: 0,
  readSet: new Set([rEntries[0].id]),
  readAtByEntry: new Map([[rEntries[0].id, explicitReadAt]]),
};
const item = withReadState(rEntries[0], rcExplicit);
check("explicit read → isNew=false", item.isNew === false);
check("explicit read → readAt = read row timestamp", item.readAt === explicitReadAt);

// ── Watermark still works for entries with no explicit read ──
const rcWatermark: ReadContext = emptyReadContext(NOW - DAY);
const oldAssembled = withReadState(rEntries[0], rcWatermark); // atMs = NOW - 1d, seen = NOW - 1d
check("watermark marks older entry read", oldAssembled.isNew === false);
check("watermark leaves entry readAt null (implicit only)", oldAssembled.readAt === null);

// ── assembleFeed end-to-end ──
// The lock's atMs crosses the 24h reminder threshold (NOW+6h-24h = NOW-18h),
// so it's newer than the NOW-1d watermark → unread. The reaction is explicitly
// read; the recap is at the watermark boundary → read. So unread = 1.
const rcMixed: ReadContext = {
  seenAtMs: NOW - 1 * DAY,
  readSet: new Set([rEntries[0].id]),
  readAtByEntry: new Map([[rEntries[0].id, NOW - 6 * HOUR]]),
};
const feed = assembleFeed(
  [
    ...rEntries,
    ...(futureLock ? [futureLock] : []),
    ...(recentRecap ? [recentRecap] : []),
  ],
  rcMixed,
  30,
  NOW,
);
check("assembleFeed: explicit read of reaction + watermark = 1 unread (the lock)", feed.unread === 1);
check("assembleFeed: total reflects all entries", feed.total === 3);
check("assembleFeed: generatedAtMs is now", feed.generatedAtMs === NOW);
check("assembleFeed: unread entry is the lock", feed.items[0].kind === "stage" && feed.items[0].isNew === true);
check("assembleFeed: read entries still present (read state is a flag, not a filter)", feed.items.filter((i) => !i.isNew).length === 2);
// And with a fresh watermark everything is unread again.
const rcFresh: ReadContext = emptyReadContext(0);
const freshFeed = assembleFeed(
  [
    ...rEntries,
    ...(futureLock ? [futureLock] : []),
    ...(recentRecap ? [recentRecap] : []),
  ],
  rcFresh,
  30,
  NOW,
);
check("assembleFeed: fresh player → unread = total (3)", freshFeed.unread === 3);
check("assembleFeed: limit caps items (not total)", assembleFeed(
  Array.from({ length: 10 }, (_, i) => ({
    id: "x" + i, kind: "stage" as const, icon: "⏰", title: "t", body: "b", href: "/", atMs: i,
  })),
  emptyReadContext(0),
  4,
  NOW,
).items.length === 4);
check("assembleFeed: total preserves pre-limit count", assembleFeed(
  Array.from({ length: 10 }, (_, i) => ({
    id: "x" + i, kind: "stage" as const, icon: "⏰", title: "t", body: "b", href: "/", atMs: i,
  })),
  emptyReadContext(0),
  4,
  NOW,
).total === 10);
check("assembleFeed: empty feed is all-zero", (() => {
  const f = assembleFeed([], emptyReadContext(0), 30, NOW);
  return f.unread === 0 && f.items.length === 0 && f.total === 0;
})());

// ── isRead direct (no allocation) ──
const probe: Pick<NotifEntry, "id" | "atMs"> = { id: "stage:107", atMs: NOW - HOUR };
check("isRead: explicit set wins", isRead(probe, { seenAtMs: 0, readSet: new Set([probe.id]), readAtByEntry: new Map() }) === true);
check("isRead: watermark covers older entry", isRead(probe, { seenAtMs: NOW, readSet: new Set(), readAtByEntry: new Map() }) === true);
check("isRead: future entry vs old watermark is unread", isRead({ id: "x", atMs: NOW + HOUR }, { seenAtMs: NOW - DAY, readSet: new Set(), readAtByEntry: new Map() }) === false);
check("isRead: fresh entry, no watermark, no explicit set → unread", isRead(probe, emptyReadContext(0)) === false);

// ── parseNotifPrefs + filterEntriesByPrefs (PHA-1240) ──────────────────────────
const allEntries: Omit<NotifEntry, "isNew" | "readAt">[] = [
  { id: "reaction:1:1:0", kind: "reaction", icon: "🔥", title: "t", body: "b", href: "/", atMs: NOW, stamps: [] },
  { id: "stage:107", kind: "stage", icon: "⏰", title: "t", body: "b", href: "/", atMs: NOW },
  { id: "recap:106", kind: "recap", icon: "🎬", title: "t", body: "b", href: "/", atMs: NOW },
  { id: "announce:x", kind: "announcement", icon: "📢", title: "t", body: "b", href: "/", atMs: NOW },
];

check("parseNotifPrefs: null → defaults", (() => {
  const p = parseNotifPrefs(null);
  return p.reactions.inApp && p.stage.push && !p.reactions.push && p.stage.inApp;
})());
check("parseNotifPrefs: partial JSON merged with defaults", (() => {
  const p = parseNotifPrefs(JSON.stringify({ reactions: { inApp: false, push: false } }));
  return !p.reactions.inApp && p.stage.inApp && p.stage.push;
})());
check("parseNotifPrefs: invalid JSON → defaults", (() => {
  const p = parseNotifPrefs("{bad json");
  return p.reactions.inApp && p.stage.push;
})());
check("filterEntriesByPrefs: all on → 4 entries", filterEntriesByPrefs(allEntries, DEFAULT_NOTIF_PREFS).length === 4);
check("filterEntriesByPrefs: reactions.inApp=false removes reaction", (() => {
  const p = parseNotifPrefs(JSON.stringify({ reactions: { inApp: false, push: false } }));
  const f = filterEntriesByPrefs(allEntries, p);
  return f.length === 3 && f.every((e) => e.kind !== "reaction");
})());
check("filterEntriesByPrefs: stage.inApp=false removes stage", (() => {
  const p = parseNotifPrefs(JSON.stringify({ stage: { inApp: false, push: false } }));
  const f = filterEntriesByPrefs(allEntries, p);
  return f.length === 3 && f.every((e) => e.kind !== "stage");
})());
check("filterEntriesByPrefs: all inApp=false → empty feed", (() => {
  const p = parseNotifPrefs(JSON.stringify({
    reactions: { inApp: false, push: false },
    stage:     { inApp: false, push: false },
    recap:     { inApp: false, push: false },
    announce:  { inApp: false, push: false },
  }));
  return filterEntriesByPrefs(allEntries, p).length === 0;
})());

console.log(`\nverify-notifications: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
