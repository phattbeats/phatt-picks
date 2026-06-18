"use client";

/**
 * Header notification bell (PHA-1211 follow-up; PHA-1237 per-item read state).
 *
 * Polls GET /api/notifications for the unread count + entries across kinds
 * (reactions on your picks, upcoming stage locks, your recap, announcements).
 * The badge shows the unread count (sum of isNew across the entire feed, NOT
 * the visible dropdown slice). Opening the dropdown auto-marks all current
 * entries as read via POST { action: "readAll" } — same-origin guarded.
 * Clicking a single item also marks it read on the way out so the
 * notifications inbox page sees the same state. Derived server-side from clock
 * + rows — see notifications-core.
 *
 * Self-contained client component (owns its own fetch/poll). The parent only
 * mounts it when signed in.
 *
 * PHA-1238: the live unread count is also mirrored OUTSIDE the app so it's
 * visible without opening it — `navigator.setAppBadge()` paints the count on
 * the installed PWA icon (high value mobile-first), and the browser tab title
 * gets an "(N) " prefix. Both are driven off this component's `unread` state,
 * the single source of truth, so marking-read clears them instantly (no poll
 * lag). The bell is the only app-wide always-mounted unread surface for a
 * signed-in user, which makes it the right home for this.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/** App-badge API (Badging API) — not yet in the default DOM lib typings. */
type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Strip a leading "(N) " unread prefix so we never stack/duplicate it. */
const TITLE_PREFIX_RE = /^\(\d+\)\s+/;

interface NotifStamp { id: string; glyph: string; label: string; kind: "props" | "heat"; count: number }
interface NotifEntry {
  id: string;
  kind: "reaction" | "stage" | "recap" | "announcement";
  icon: string;
  title: string;
  body: string;
  href: string;
  atMs: number;
  isNew: boolean;
  readAt: number | null;
  stamps?: NotifStamp[];
}

const POLL_MS = 45_000;

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function postMarkOne(entryId: string) {
  try {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read", entryId }),
    });
  } catch {
    /* reconcile on next poll */
  }
}

async function postMarkAll() {
  try {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "readAll" }),
    });
  } catch {
    /* reconcile on next poll */
  }
}

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<NotifEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setUnread(typeof data.unread === "number" ? data.unread : 0);
      setTotal(typeof data.total === "number" ? data.total : 0);
      setItems(Array.isArray(data.items) ? data.items : []);
      setLoaded(true);
    } catch {
      /* offline / transient — keep last view */
    }
  }, []);

  useEffect(() => {
    // load() only setStates after an awaited fetch (never synchronously), and the
    // bell must show the count on mount + poll. Same pattern as LockCountdown.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // PHA-1238 — paint the unread count on the installed PWA app icon.
  // setAppBadge(n) shows the number; setAppBadge() (no arg) shows a generic
  // dot; clearAppBadge() removes it. Feature-detected: a no-op everywhere the
  // Badging API isn't supported (most desktop browsers, iOS Safari tabs).
  useEffect(() => {
    const nav = typeof navigator !== "undefined" ? (navigator as BadgeNavigator) : undefined;
    if (!nav?.setAppBadge) return;
    if (unread > 0) nav.setAppBadge(unread).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [unread]);

  // PHA-1238 — prefix the browser tab title with "(N) ". Pages set their own
  // titles ("Wire · HOTLINE", "Notifications · HOTLINE", …) so we PREFIX the
  // live title rather than clobber it, and re-apply on every Next-driven title
  // change via a MutationObserver on <title>. Re-prefixing is idempotent (the
  // regex strips any existing "(N) " first), so the observer settles in one
  // pass with no feedback loop.
  const unreadRef = useRef(unread);
  useEffect(() => {
    unreadRef.current = unread;
  }, [unread]);
  useEffect(() => {
    const titleEl = document.querySelector("title");
    if (!titleEl) return;
    const apply = () => {
      const base = document.title.replace(TITLE_PREFIX_RE, "");
      const next = unreadRef.current > 0 ? `(${unreadRef.current}) ${base}` : base;
      if (next !== document.title) document.title = next;
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(titleEl, { childList: true });
    return () => {
      obs.disconnect();
      // Bell unmounting (sign-out): drop the prefix and clear the app badge so
      // a stale count can't linger on the tab or icon.
      document.title = document.title.replace(TITLE_PREFIX_RE, "");
      const nav = navigator as BadgeNavigator;
      nav.clearAppBadge?.().catch(() => {});
    };
  }, []);

  // Re-apply the title prefix the moment the count changes (the observer only
  // fires on Next's own title writes, not on our state updates).
  useEffect(() => {
    const base = document.title.replace(TITLE_PREFIX_RE, "");
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
  }, [unread]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Optimistic local clear so the badge doesn't show a stale count while
      // the server is writing NotificationRead rows.
      setUnread(0);
      setItems((prev) => prev.map((it) => ({ ...it, isNew: false, readAt: it.readAt ?? Date.now() })));
      await postMarkAll();
    }
  }

  // Single-item read: optimistic flip on click, then mark. The Link
  // navigation runs naturally — we don't preventDefault. If the player used
  // cmd-click / middle-click to open in a new tab we still want the read
  // to fire on the original page, so we use mousedown (before navigation)
  // and the primary-button check.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      const link = target?.closest<HTMLAnchorElement>("a.notifbell-link");
      if (!link) return;
      const li = link.closest<HTMLLIElement>("li.notifbell-item");
      const id = li?.dataset.entryId;
      if (!id) return;
      const fresh = li?.classList.contains("fresh");
      if (!fresh) return;
      // Optimistic UI: drop the fresh class, badge, and dot before the
      // server response arrives. We DON'T call e.preventDefault — let the
      // browser navigate as the user expected.
      li?.classList.remove("fresh");
      const dot = li?.querySelector(".notifbell-dot");
      if (dot) dot.remove();
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, isNew: false, readAt: Date.now() } : x)));
      setUnread((n) => Math.max(0, n - 1));
      void postMarkOne(id);
    }
    const root = rootRef.current;
    if (!root) return;
    root.addEventListener("mousedown", onMouseDown);
    return () => root.removeEventListener("mousedown", onMouseDown);
  }, []);

  return (
    <div className="notifbell" ref={rootRef}>
      <button
        type="button"
        className="notifbell-btn"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications — ${unread} new` : "Notifications"}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notifbell-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="notifbell-panel" role="menu">
          <div className="notifbell-head">
            <span>NOTIFICATIONS</span>
            {total > 0 && (
              <Link
                href="/notifications"
                className="notifbell-seeall"
                onClick={() => setOpen(false)}
              >
                See all ({total})
              </Link>
            )}
          </div>
          {!loaded ? (
            <div className="notifbell-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="notifbell-empty">You&apos;re all caught up.</div>
          ) : (
            <>
              <ul className="notifbell-list">
                {items.map((it) => (
                  <li key={it.id} data-entry-id={it.id} className={`notifbell-item${it.isNew ? " fresh" : ""}`}>
                    <Link
                      href={it.href}
                      className="notifbell-link"
                      onClick={() => setOpen(false)}
                    >
                      <span className={`notifbell-icon ${it.kind}`} aria-hidden="true">{it.icon}</span>
                      <span className="notifbell-text">
                        <span className="notifbell-title">{it.title}</span>
                        {it.kind === "reaction" && it.stamps ? (
                          <span className="notifbell-stamps">
                            {it.stamps.map((s) => (
                              <span key={s.id} className={`notifbell-stamp ${s.kind}`}>
                                <span aria-hidden="true">{s.glyph}</span>
                                <span className="notifbell-ct">{s.count}</span>
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="notifbell-body">{it.body}</span>
                        )}
                        <span className="notifbell-meta">{timeAgo(it.atMs)}</span>
                      </span>
                      {it.isNew && <span className="notifbell-dot" aria-label="new" />}
                    </Link>
                  </li>
                ))}
              </ul>
              {unread > 0 && (
                <div className="notifbell-foot">
                  <button
                    type="button"
                    className="notifbell-markall"
                    onClick={async () => {
                      setUnread(0);
                      setItems((prev) => prev.map((x) => ({ ...x, isNew: false, readAt: x.readAt ?? Date.now() })));
                      await postMarkAll();
                    }}
                  >
                    Mark all as read
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
