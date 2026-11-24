/**
 * verify-notifications — offline proof for the #1211 universal notification
 * feed + #1237 per-notification read state.
 *
 *   1. reactionEntries group inbound reactions by pick, tally stamps, and
 *      resolve the team/stage label (no isNew — that's layered on later).
 *   2. stageLockEntry surfaces only FUTURE locks inside the lead window — a
 *      passed lock or one too far out yields null (no backfill).
 *   3. recapEntry surfaces a recent resolved stage; one older than maxAge is
 *      dropped (no backfill).
 *   4. assembleFeed + ReadContext: explicit per-entry read beats the
 *      notificationsSeenAt watermark; a re-emerging entry (atMs after the
 *      read's readAt) goes back to unread. #1237.
 *   5. unknown stampIds are dropped, never counted.
 *
 * Pure module, no DB. Run: node scripts/verify-notifications.ts
 */

import {
  reactionEntries,
  stageLockEntry,
  recapEntry,
  coinEarnedEntry,
  fantasyDraftEntry,
  fantasyFinalEntry,
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
import {
  FANTASY_REMINDER_OFFSETS_MS,
  buildFantasyFinalPayload,
  buildFantasyOpenPayload,
  buildFantasyPointsPayload,
  buildFantasyReminderPayload,
  formatPoints,
} from "../src/lib/notify-core.ts";

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
// #1245 follow-up: recap deep-links to the stage's reveal page + force-opens
// the cinematic deck (clicking "/" did nothing once the device dismissed it).
check("recap href deep-links to the reveal page with ?wrapped=1",
  recentRecap?.href === "/reveal/107?wrapped=1");

// ── ReadContext: explicit per-entry read beats the watermark (#1237) ──
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

// ── parseNotifPrefs + filterEntriesByPrefs (#1240) ──────────────────────────
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

// ── 6. Challenge coin earned (#1278) ──────────────────────────────────────
const COIN_NOW = 1_000 * 24 * 3600_000;
check("coinEarnedEntry: fresh coin → entry with stable id + atMs", (() => {
  const e = coinEarnedEntry(
    { eventId: 26, eventName: "IEM Cologne 2026", tier: "diamond", earnedAtMs: COIN_NOW - 3600_000 },
    COIN_NOW,
  );
  return !!e && e.id === "coin:26" && e.kind === "coin" && e.href === "/majors" && e.atMs === COIN_NOW - 3600_000;
})());
check("coinEarnedEntry: tier appears in the title", (() => {
  const e = coinEarnedEntry({ eventId: 24, eventName: "Old Major", tier: "bronze", earnedAtMs: COIN_NOW }, COIN_NOW);
  return !!e && /Bronze/.test(e.title);
})());
check("coinEarnedEntry: older than maxAge → null (no backfill)", (() => {
  const e = coinEarnedEntry(
    { eventId: 26, eventName: "X", tier: "gold", earnedAtMs: COIN_NOW - 40 * 24 * 3600_000 },
    COIN_NOW,
  );
  return e === null;
})());
check("coin prefs default: in-app + push on", DEFAULT_NOTIF_PREFS.coin.inApp === true && DEFAULT_NOTIF_PREFS.coin.push === true);
check("filterEntriesByPrefs: coin.inApp=false drops the coin entry", (() => {
  const coin = coinEarnedEntry({ eventId: 26, eventName: "X", tier: "silver", earnedAtMs: COIN_NOW }, COIN_NOW)!;
  const p = parseNotifPrefs(JSON.stringify({ coin: { inApp: false, push: false } }));
  return filterEntriesByPrefs([coin], p).length === 0;
})());
check("parseNotifPrefs: coin falls back to defaults when absent", (() => {
  const p = parseNotifPrefs(JSON.stringify({ reactions: { inApp: false, push: false } }));
  return p.coin.inApp === true && p.coin.push === true;
})());

// ── delete (dismissedAt) ──
{
  const e = { id: "x", kind: "announcement" as const, icon: "", title: "X", body: "", href: "/", atMs: NOW - HOUR };
  const keep = { ...e, id: "y" };
  const rc = (dismissedAt: number): ReadContext => ({
    ...emptyReadContext(0),
    readSet: new Set(["x"]),
    readAtByEntry: new Map([["x", dismissedAt]]),
    dismissedAtByEntry: new Map([["x", dismissedAt]]),
  });
  const gone = assembleFeed([e, keep], rc(NOW), 30, NOW);
  check("delete: a deleted entry leaves the feed", gone.total === 1 && gone.items[0].id === "y");
  const back = assembleFeed([{ ...e, atMs: NOW }], rc(NOW - HOUR / 2), 30, NOW);
  check("delete: new activity on a deleted entry brings it back, unread", back.total === 1 && back.items[0].isNew);
}

// ── 7. Fantasy (PHA-5454) ─────────────────────────────────────────────────
{
  const H = 3600_000;
  const open = buildFantasyOpenPayload({ stageName: "Stage I", stageId: 111, startMs: NOW + 21 * H, nowMs: NOW });
  check("fantasy open push: names the stage, the countdown and deep-links to the draft",
    open.body === "Stage I draft is open. Pick your five: it starts in 21 hours." && open.url === "/fantasy?stage=111&view=team" && open.tag === "fantasy-open:111");
  check("fantasy open push: no countdown while the start is unpublished",
    buildFantasyOpenPayload({ stageName: "Stage II", stageId: 112, startMs: null, nowMs: NOW }).body === "Stage II draft is open. Pick your five.");
  check("fantasy reminder push: 1 hour out",
    buildFantasyReminderPayload({ stageName: "Stage I", stageId: 111, startMs: NOW + H, nowMs: NOW }).body === "Stage I starts in 1 hour and you have no team. Draft your five.");
  const pts = buildFantasyPointsPayload({
    stageName: "Stage I", stageId: 111, gained: 1345,
    gains: [{ nick: "donk", points: 535 }, { nick: "ZywOo", points: 400 }, { nick: "m0NESY", points: 300 }, { nick: "ropz", points: 110 }],
    total: 2640, rank: 2, managers: 6,
  });
  check("fantasy points push: gain in the title, top three named, standing last",
    pts.title === "Your five: +1,345 pts" && pts.body === "donk +535, ZywOo +400, m0NESY +300. Stage I: 2,640 pts, #2 of 6." && pts.tag === "fantasy-points:111");
  check("fantasy final push: rank and total",
    buildFantasyFinalPayload({ stageName: "Stage I", stageId: 111, total: 2640, rank: 2, managers: 6 }).body === "Stage I is final. Your five finished #2 of 6 with 2,640 pts.");
  check("formatPoints: thousands separators", formatPoints(999) === "999" && formatPoints(1000) === "1,000" && formatPoints(1234567) === "1,234,567");
  check("fantasy reminders fire 24 h and 1 h before the start", FANTASY_REMINDER_OFFSETS_MS.join() === `${24 * H},${H}`);
  check("fantasy prefs default: in-app + push on", DEFAULT_NOTIF_PREFS.fantasy.inApp === true && DEFAULT_NOTIF_PREFS.fantasy.push === true);
  check("parseNotifPrefs: fantasy falls back to defaults on an old blob, and honours an opt-out",
    parseNotifPrefs(JSON.stringify({ stage: { inApp: true, push: false } })).fantasy.push === true &&
    parseNotifPrefs(JSON.stringify({ fantasy: { inApp: true, push: false } })).fantasy.push === false);
  const draft = fantasyDraftEntry({ stageId: 111, stageName: "Stage I", openedAtMs: NOW - H, startMs: NOW + 5 * H, hasLineup: false }, NOW);
  check("fantasy draft entry: shown while open with no team", !!draft && draft.id === "fantasy-open:111" && draft.kind === "fantasy" && draft.atMs === NOW - H);
  check("fantasy draft entry: gone once you have a team", fantasyDraftEntry({ stageId: 111, stageName: "Stage I", openedAtMs: NOW - H, startMs: NOW + 5 * H, hasLineup: true }, NOW) === null);
  check("fantasy draft entry: gone once the stage has started", fantasyDraftEntry({ stageId: 111, stageName: "Stage I", openedAtMs: NOW - 9 * H, startMs: NOW - H, hasLineup: false }, NOW) === null);
  const fin = fantasyFinalEntry({ stageId: 111, stageName: "Stage I", finalAtMs: NOW - H, rank: 2, managers: 6, total: 2640 }, NOW);
  check("fantasy final entry: rank in the body, links to the league", !!fin && fin.body === "Your five finished #2 of 6 with 2640 pts." && fin.href === "/fantasy?stage=111&view=league");
  check("fantasy final entry: an old stage does not backfill", fantasyFinalEntry({ stageId: 111, stageName: "Stage I", finalAtMs: NOW - 30 * 24 * H, rank: 2, managers: 6, total: 1 }, NOW) === null);
  check("filterEntriesByPrefs: fantasy.inApp=false drops fantasy entries",
    filterEntriesByPrefs([draft!], parseNotifPrefs(JSON.stringify({ fantasy: { inApp: false, push: false } }))).length === 0);
}

console.log(`\nverify-notifications: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
