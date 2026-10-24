import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { type NotifEntry } from "@/lib/notifications-core";
import { buildPlayerFeed } from "@/lib/notifications-feed";
import { NotifGlyph } from "@/components/heat/NotifGlyph";
import { InboxControls } from "./InboxControls";
import { PHOTOS } from "@/lib/photos";

export const metadata = { title: "Inbox · HOTLINE" };
export const dynamic = "force-dynamic";

const INBOX_PAGE_SIZE = 30;
const INBOX_HARD_CAP = 200;

/**
 * Full-history notifications inbox (#1236) with per-item read state
 * (#1237). The header bell is the quick peek — this page is everything
 * that's still relevant, grouped by Today / This week / Earlier, with
 * page-size pagination via ?page=N and an All/Unread tab driven by the
 * per-entry NotificationRead table. Mark-all-read and click-to-mark-read
 * route through the client component (InboxControls).
 *
 * Singapore skin (prototype 16): a "Needs you" lead panel surfaces the first
 * unread stage-lock entry; every row is a hairline list item with a kind glyph
 * (the coin-earned row shows the struck coin) and an amber unread dot.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; filter?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    // There's no inbox without an account, so this route redirects — unlike
    // most (app) routes, which render an anonymous-friendly view in place.
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

  // The lead: the first unread stage-lock entry, if any — the one thing in the
  // feed that needs action before a clock runs out.
  const lead = page === 1 ? all.items.find((i) => i.isNew && i.kind === "stage") : undefined;

  // The client component handles per-item click and Mark-all-read, and toggles
  // the All/Unread tab.

  return (
    <div className="sg-page nf-page">
      <div className="chap-h row2 rise">
        <div>
          <span className="n">
            Inbox{all.unread > 0 ? ` · ${all.unread} unread` : " · all read"}
          </span>
          <h1 className="nf-title">Your feed</h1>
          <p>
            Stage locks, recaps, reactions on your picks and the occasional broadcast.
            Anything older than <b>14 days</b> falls off.
          </p>
        </div>
        <Link href="/settings#alerts" className="eyebrow" prefetch={false}>
          Alert settings →
        </Link>
      </div>

      {lead && (
        <section className="nf-lead rise d1">
          <div className="nf-lead-ph photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PHOTOS.notificationsEmpty} alt="" loading="lazy" decoding="async" />
            <span className="credit">IEM Cologne Major 2026 · HLTV</span>
          </div>
          <div className="nf-lead-b">
            <span className="live">Needs you</span>
            <span className="nf-lead-t">{lead.title}</span>
            <p className="muted">{lead.body}</p>
            <Link href={lead.href} className="btn-solid nf-lead-cta" prefetch={false}>
              Make picks
            </Link>
          </div>
        </section>
      )}

      <InboxControls filter={filter} unread={all.unread} page={page} />

      {total === 0 ? (
        <EmptyInbox filter={filter} />
      ) : (
        <div className="inbox-wrap" data-page={page} data-total={total} data-pagecount={pageCount}>
          <div className="inbox-meta">
            Showing <b>{start + 1}</b>–<b>{Math.min(start + INBOX_PAGE_SIZE, total)}</b> of <b>{total}</b>
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
    </div>
  );
}

// ── ROW COMPONENT ─────────────────────────────────────────────────────────────

const GO_LABEL: Record<string, string> = {
  stage: "Make picks",
  recap: "Open recap",
  coin: "Inspect",
  achievement: "See it",
  reaction: "View picks",
  announcement: "Open",
};

function InboxRow({ item, now }: { item: NotifEntry; now: number }) {
  return (
    <li className={`inbox-row k-${item.kind}${item.isNew ? " fresh" : ""}`} data-entry-id={item.id}>
      <Link
        href={item.href}
        className="inbox-link"
        prefetch={false}
        data-mark-on-click={item.isNew ? "true" : undefined}
      >
        <NotifGlyph kind={item.kind} id={item.id} title={item.title} size="lg" />
        <span className="inbox-text">
          <span className="inbox-title">
            {item.isNew && <span className="inbox-dot" aria-label="new" />}
            {item.title}
          </span>
          {item.kind === "reaction" && item.stamps ? (
            <span className="nf-stamps">
              {item.stamps.map((s) => (
                <span key={s.id} className={`nf-stamp ${s.kind}`} title={s.label}>
                  <span aria-hidden="true">{s.glyph}</span>
                  <span className="ct">{s.count}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="inbox-body">{item.body}</span>
          )}
          {item.readAt != null && (
            <span className="inbox-read">Read {timeAgo(item.readAt, now)}</span>
          )}
        </span>
        <span className="inbox-r">
          <span className="inbox-when">{whenLabel(item.atMs, now)}</span>
          <span className="inbox-go">{GO_LABEL[item.kind] ?? "Open"} →</span>
        </span>
      </Link>
      <button type="button" className="inbox-del" aria-label={`Delete: ${item.title}`} title="Delete">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
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
        <Link href={hrefFor(prev)} className="inbox-pager-link prev" rel="prev" prefetch={false}>
          ← Newer
        </Link>
      ) : (
        <span className="inbox-pager-link prev disabled" aria-disabled="true">← Newer</span>
      )}
      <span className="inbox-pager-of">
        Page {page} of {pageCount}
      </span>
      {next != null ? (
        <Link href={hrefFor(next)} className="inbox-pager-link next" rel="next" prefetch={false}>
          Older →
        </Link>
      ) : (
        <span className="inbox-pager-link next disabled" aria-disabled="true">Older →</span>
      )}
    </nav>
  );
}

// ── EMPTY STATE ───────────────────────────────────────────────────────────────

function EmptyInbox({ filter }: { filter: "all" | "unread" }) {
  return (
    <section className="nf-empty">
      <span className="eyebrow">
        <b>All caught up</b>
      </span>
      <p className="nf-empty-t">{filter === "unread" ? "Nothing unread" : "Nothing new"}</p>
      <p className="muted">
        Stage locks, recaps, reactions on your picks and broadcasts land here the moment they happen.
      </p>
      <Link href="/picks" className="btn-solid" prefetch={false}>
        Make your picks
      </Link>
    </section>
  );
}

// ── HELPERS (server-only) ─────────────────────────────────────────────────────

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

/** Compact right-column stamp: "now" / "12m" / "4h" / "Tue" / "21 Jun". */
function whenLabel(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = new Date(ms);
  if (now - ms < 6 * DAY_MS) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
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
