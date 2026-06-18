import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  assembleFeed,
  emptyReadContext,
  type NotifEntry,
  type ReadContext,
} from "@/lib/notifications-core";
import { announcementEntries } from "@/lib/announcements-core";
import { prisma } from "@/lib/db";
import { currentEventId, currentEvent } from "@/lib/events-core";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import { lockTimeForSection } from "@/lib/lock-schedule-core";
import { latestWrappedSectionId } from "@/lib/stage-wrapped-launch-core";
import type { OutcomeMap } from "@/lib/scoring";
import {
  reactionEntries,
  stageLockEntry,
  recapEntry,
  filterEntriesByPrefs,
  parseNotifPrefs,
  type NotifReaction,
  type PickLabeller,
} from "@/lib/notifications-core";
import { InboxControls } from "./InboxControls";

export const metadata = { title: "Notifications · HOTLINE" };
export const dynamic = "force-dynamic";

const INBOX_PAGE_SIZE = 30;
const INBOX_HARD_CAP = 200;

/**
 * Full-history notifications inbox (PHA-1236) with per-item read state
 * (PHA-1237). The header bell is the quick peek — this page is everything
 * that's still relevant, grouped by Today / This week / Earlier, with
 * page-size pagination via ?page=N and an All/Unread tab driven by the
 * per-entry NotificationRead table. Mark-all-read and click-to-mark-read
 * route through the client component (InboxControls).
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; filter?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    // Anonymous viewers get bounced to the sign-in surface, same as the rest
    // of the (app) routes.
    redirect("/login?next=/notifications");
  }

  const { page: rawPage, filter: rawFilter } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const filter = rawFilter === "unread" ? "unread" : "all";

  // Build the full feed server-side, then paginate client-side. The ReadContext
  // is built from BOTH the legacy notificationsSeenAt watermark and the
  // per-entry NotificationRead table — withReadState applies the union inside
  // assembleFeed.
  const all = await buildPlayerFeed(session.playerId, INBOX_HARD_CAP);
  const visibleItems = filter === "unread" ? all.items.filter((i) => i.isNew) : all.items;
  const total = visibleItems.length;
  const pageCount = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE));
  const page = Math.min(pageNum, pageCount);
  const start = (page - 1) * INBOX_PAGE_SIZE;
  const pageItems = visibleItems.slice(start, start + INBOX_PAGE_SIZE);

  const groups = groupByTime(pageItems, all.generatedAtMs);

  // The client component handles per-item click and Mark-all-read, and toggles
  // the All/Unread tab. We pass the visible ids down so the bulk action knows
  // which rows to mark without a second round trip.
  const visibleIds = pageItems.map((it) => it.id);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">YOUR FEED</span>
        <h1
          className="font-display"
          style={{
            fontWeight: 800,
            fontSize: "clamp(28px, 5vw, 40px)",
            textTransform: "uppercase",
            lineHeight: 0.95,
          }}
        >
          Notifications
        </h1>
        <p
          style={{
            color: "var(--ink-mid)",
            fontSize: 13,
            margin: "4px 0 0",
            lineHeight: 1.5,
          }}
        >
          Reactions on your picks, upcoming stage locks, your latest recap, and
          the occasional broadcast. Everything older than 14 days falls off
          (no backfill of stale recaps).
        </p>
      </div>

      <InboxControls
        filter={filter}
        unread={all.unread}
        visibleIds={visibleIds}
        page={page}
      />

      {total === 0 ? (
        <EmptyInbox />
      ) : (
        <div className="inbox-wrap" data-page={page} data-total={total} data-pagecount={pageCount}>
          <div className="inbox-meta">
            <span className="inbox-count">
              Showing <strong>{start + 1}</strong>–<strong>{Math.min(start + INBOX_PAGE_SIZE, total)}</strong> of <strong>{total}</strong>
            </span>
            {all.unread > 0 && (
              <span className="inbox-unread">
                {all.unread} new
              </span>
            )}
          </div>

          {groups.map((g) => (
            <section key={g.label} className="inbox-group">
              <h2 className="inbox-group-head">{g.label}</h2>
              <ul className="inbox-list">
                {g.items.map((it) => (
                  <InboxRow key={it.id} item={it} now={all.generatedAtMs} />
                ))}
              </ul>
            </section>
          ))}

          <Pagination page={page} pageCount={pageCount} filter={filter} />
        </div>
      )}
    </>
  );
}

// ── ROW COMPONENT ─────────────────────────────────────────────────────────────

function InboxRow({ item, now }: { item: NotifEntry; now: number }) {
  return (
    <li className={`inbox-row${item.isNew ? " fresh" : ""}`} data-entry-id={item.id}>
      <Link href={item.href} className="inbox-link" data-mark-on-click={item.isNew ? "true" : undefined}>
        <span className={`inbox-icon ${item.kind}`} aria-hidden="true">
          {item.icon}
        </span>
        <span className="inbox-text">
          <span className="inbox-title">{item.title}</span>
          {item.kind === "reaction" && item.stamps ? (
            <span className="inbox-stamps">
              {item.stamps.map((s) => (
                <span key={s.id} className={`inbox-stamp ${s.kind}`}>
                  <span aria-hidden="true">{s.glyph}</span>
                  <span className="inbox-ct">{s.count}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="inbox-body">{item.body}</span>
          )}
          <span className="inbox-meta-line">
            <span className="inbox-when">{timeAgo(item.atMs, now)}</span>
            {item.readAt != null && (
              <span className="inbox-read">read {timeAgo(item.readAt, now)}</span>
            )}
          </span>
        </span>
        {item.isNew && <span className="inbox-dot" aria-label="new" />}
      </Link>
    </li>
  );
}

// ── PAGINATION ────────────────────────────────────────────────────────────────

function Pagination({ page, pageCount, filter }: { page: number; pageCount: number; filter: string }) {
  if (pageCount <= 1) return null;
  const prev = page > 1 ? page - 1 : null;
  const next = page < pageCount ? page + 1 : null;
  const hrefFor = (p: number) =>
    filter === "unread" ? `/notifications?filter=unread&page=${p}` : `/notifications?page=${p}`;
  return (
    <nav className="inbox-pager" aria-label="Notifications pages">
      {prev != null ? (
        <Link href={hrefFor(prev)} className="inbox-pager-link prev" rel="prev">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Newer
        </Link>
      ) : (
        <span className="inbox-pager-link prev disabled" aria-disabled="true">Newer</span>
      )}
      <span className="inbox-pager-of">
        Page {page} of {pageCount}
      </span>
      {next != null ? (
        <Link href={hrefFor(next)} className="inbox-pager-link next" rel="next">
          Older
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      ) : (
        <span className="inbox-pager-link next disabled" aria-disabled="true">Older</span>
      )}
    </nav>
  );
}

// ── EMPTY STATE ───────────────────────────────────────────────────────────────

function EmptyInbox() {
  return (
    <section className="panel brk" style={{ padding: "44px 24px", textAlign: "center" }}>
      <span className="br-tr" />
      <span className="br-bl" />
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--heat)",
          marginBottom: 14,
        }}
      >
        You&apos;re all caught up
      </div>
      <p
        className="font-display"
        style={{
          fontWeight: 800,
          fontSize: 24,
          color: "var(--ink-hi)",
          textTransform: "uppercase",
          margin: "0 0 8px",
        }}
      >
        No notifications
      </p>
      <p
        style={{
          color: "var(--ink-mid)",
          fontSize: 14,
          maxWidth: 320,
          margin: "0 auto 18px",
          lineHeight: 1.55,
        }}
      >
        New reactions on your picks, upcoming stage locks, and the broadcast channel will all land here.
      </p>
      <Link href="/picks" className="btn-heat">
        Go make your picks
        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </Link>
    </section>
  );
}

// ── HELPERS (server-only) ─────────────────────────────────────────────────────

async function buildPlayerFeed(playerId: string, limit: number) {
  const eventId = currentEventId();
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const [reactions, player, myPicks, outcomes, reads] = await Promise.all([
    prisma.reaction.findMany({
      where: { eventId, targetPlayerId: playerId },
      select: { stampId: true, sectionId: true, groupId: true, slotIndex: true, createdAt: true },
    }),
    prisma.player.findUnique({
      where: { id: playerId },
      select: { notificationsSeenAt: true, notifPrefs: true },
    }),
    prisma.pick.findMany({
      where: { eventId, playerId },
      select: { sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
    prisma.stageOutcome.findMany({
      where: { eventId },
      select: { sectionId: true, groupId: true, slotIndex: true, winnerPickId: true, resolvedAt: true },
    }),
    prisma.notificationRead.findMany({
      where: { playerId },
      select: { entryId: true, readAt: true },
    }),
  ]);

  const seenAtMs = player?.notificationsSeenAt ? player.notificationsSeenAt.getTime() : 0;
  const readSet = new Set<string>();
  const readAtByEntry = new Map<string, number>();
  for (const r of reads) {
    readSet.add(r.entryId);
    readAtByEntry.set(r.entryId, r.readAt.getTime());
  }
  const rc: ReadContext = { seenAtMs, readSet, readAtByEntry };
  const prefs = parseNotifPrefs(player?.notifPrefs);

  const layout = getCommittedLayout();
  const teamMap = buildTeamMap(layout);
  const event = currentEvent(nowMs);
  const stageName = (sectionId: number): string =>
    event.sectionNames[sectionId] ??
    layout.sections.find((s) => s.sectionid === sectionId)?.name.split(" | ")[0] ??
    "Stage";

  const rawEntries: Omit<NotifEntry, "isNew" | "readAt">[] = [];

  rawEntries.push(...announcementEntries(nowMs));

  const pickByKey = new Map<string, number>();
  for (const p of myPicks) pickByKey.set(`${p.sectionId}:${p.groupId}:${p.slotIndex}`, p.pickId);
  const label: PickLabeller = (sectionId, groupId, slotIndex) => {
    const pickId = pickByKey.get(`${sectionId}:${groupId}:${slotIndex}`);
    const team = pickId ? teamMap.get(pickId) : undefined;
    return { teamName: team?.name ?? null, stageLabel: stageName(sectionId) };
  };
  const reactionRows: NotifReaction[] = reactions.map((r) => ({
    stampId: r.stampId,
    sectionId: r.sectionId,
    groupId: r.groupId,
    slotIndex: r.slotIndex,
    createdAtMs: r.createdAt.getTime(),
  }));
  rawEntries.push(...reactionEntries(reactionRows, label));

  for (const s of layout.sections) {
    const iso = lockTimeForSection(s.sectionid);
    if (!iso) continue;
    const e = stageLockEntry(
      { sectionId: s.sectionid, stageName: stageName(s.sectionid), lockAtMs: Date.parse(iso) },
      nowMs,
    );
    if (e) rawEntries.push(e);
  }

  const outcomeMap: OutcomeMap = {};
  const resolvedAtBySection = new Map<number, number>();
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    resolvedAtBySection.set(
      o.sectionId,
      Math.max(resolvedAtBySection.get(o.sectionId) ?? 0, o.resolvedAt.getTime()),
    );
  }
  const recapSection = latestWrappedSectionId(layout, outcomeMap);
  if (recapSection != null) {
    const e = recapEntry(
      {
        sectionId: recapSection,
        stageName: stageName(recapSection),
        resolvedAtMs: resolvedAtBySection.get(recapSection) ?? 0,
      },
      nowMs,
    );
    if (e) rawEntries.push(e);
  }

  return assembleFeed(filterEntriesByPrefs(rawEntries, prefs), rc, limit, nowMs);
}

const DAY_MS = 24 * 60 * 60_000;

function timeAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface TimeGroup {
  label: string;
  items: NotifEntry[];
}

function groupByTime(items: readonly NotifEntry[], now: number): TimeGroup[] {
  // Build a small "start of day" boundary in the server's timezone. The page
  // groups relative to the rendered instant, so the same `now` is used to keep
  // the groups deterministic for the request.
  const startOfToday = startOfLocalDay(now);
  const startOfThisWeek = startOfLocalDay(now - 6 * DAY_MS);
  const today: NotifEntry[] = [];
  const thisWeek: NotifEntry[] = [];
  const earlier: NotifEntry[] = [];
  for (const it of items) {
    if (it.atMs >= startOfToday) today.push(it);
    else if (it.atMs >= startOfThisWeek) thisWeek.push(it);
    else earlier.push(it);
  }
  const out: TimeGroup[] = [];
  if (today.length > 0) out.push({ label: "Today", items: today });
  if (thisWeek.length > 0) out.push({ label: "This week", items: thisWeek });
  if (earlier.length > 0) out.push({ label: "Earlier", items: earlier });
  return out;
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
