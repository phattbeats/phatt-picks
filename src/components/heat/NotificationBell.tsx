"use client";

/**
 * Header notification bell (PHA-1211 follow-up; PHA-1237 per-item read state;
 * PHA-1238 PWA badge + tab title; PHA-1241 real-time SSE delivery).
 *
 * Connects to GET /api/notifications/stream for instant badge + feed updates.
 * Falls back to 45s polling when EventSource is unavailable or fails three
 * times in a row. In-app toasts appear when the stream detects newly-arrived
 * unread items. Opening the dropdown marks all visible entries read via POST
 * { action: "readAll" }; clicking a single item marks it via mousedown
 * (fires before navigation) POST { action: "read", entryId }.
 *
 * PHA-1238: the live unread count is also mirrored OUTSIDE the app so it's
 * visible without opening it — `navigator.setAppBadge()` paints the count on
 * the installed PWA icon (high value mobile-first), and the browser tab title
 * gets an "(N) " prefix. Both are driven off this component's `unread` state,
 * the single source of truth, so marking-read clears them instantly.
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

interface FeedPayload {
  unread: number;
  total: number;
  items: NotifEntry[];
  generatedAtMs: number;
}

interface ToastItem {
  id: string;
  icon: string;
  title: string;
  href: string;
  dismissAt: number;
}

const FALLBACK_POLL_MS = 45_000;
const TOAST_TTL_MS = 5_000;
const MAX_TOASTS = 3;

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
    /* reconcile on next stream update */
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
    /* reconcile on next stream update */
  }
}

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<NotifEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  // Track item ids the client has seen so we can detect genuinely new arrivals
  const knownIdsRef = useRef<Set<string>>(new Set());

  // Polling fallback: plain fetch used when SSE is unavailable / gave up
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      if (!res.ok) return;
      const data: FeedPayload = await res.json();
      knownIdsRef.current = new Set(data.items.map((it) => it.id));
      setUnread(data.unread);
      setTotal(data.total);
      setItems(Array.isArray(data.items) ? data.items : []);
      setLoaded(true);
    } catch {
      /* offline / transient — keep last view */
    }
  }, []);

  // Apply a feed payload; toastNew=true shows toasts for items that weren't
  // in the previous snapshot AND are still unread.
  const applyFeed = useCallback((data: FeedPayload, toastNew: boolean) => {
    if (toastNew) {
      const now = Date.now();
      const arrivals = data.items.filter(
        (it) => it.isNew && !knownIdsRef.current.has(it.id),
      );
      if (arrivals.length > 0) {
        setToasts((prev) => {
          const alive = prev.filter((t) => t.dismissAt > now);
          const fresh = arrivals.slice(0, MAX_TOASTS).map((it) => ({
            id: it.id,
            icon: it.icon,
            title: it.title,
            href: it.href,
            dismissAt: now + TOAST_TTL_MS,
          }));
          return [...alive, ...fresh].slice(-MAX_TOASTS);
        });
      }
    }
    knownIdsRef.current = new Set(data.items.map((it) => it.id));
    setUnread(data.unread);
    setTotal(data.total);
    setItems(Array.isArray(data.items) ? data.items : []);
    setLoaded(true);
  }, []);

  // PHA-1238 — paint the unread count on the installed PWA app icon.
  useEffect(() => {
    const nav = typeof navigator !== "undefined" ? (navigator as BadgeNavigator) : undefined;
    if (!nav?.setAppBadge) return;
    if (unread > 0) nav.setAppBadge(unread).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [unread]);

  // PHA-1238 — prefix the browser tab title with "(N) " when unread.
  //
  // PHA-1269 CRITICAL FIX: the previous version watched <title> with a
  // MutationObserver and re-applied the prefix on every mutation. Next.js/React
  // also own <title> (route metadata), so the two fought: React reset the title
  // to the route's value, the observer instantly re-prepended "(N)", React reset
  // again — a sustained title mutation / re-render loop that pegged the main
  // thread ~100%. It only ran for signed-in users (the bell renders authed), so
  // every logged-in page "worked for a second, then froze and crashed Chrome"
  // on low-RAM Android within ~5-10s. We now just set the title when the unread
  // count changes — no observer, nothing to fight React with, nothing to loop.
  useEffect(() => {
    const base = document.title.replace(TITLE_PREFIX_RE, "");
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
    return () => {
      document.title = document.title.replace(TITLE_PREFIX_RE, "");
    };
  }, [unread]);

  // PHA-1241 — SSE connection, with polling fallback after 3 failed attempts.
  // PHA-1267 — the stream is paused while the tab is hidden. A backgrounded tab
  // or installed PWA otherwise holds an open SSE connection that the server
  // re-polls every 30s and recycles every 10 min — sustained client + server
  // churn for a view nobody is looking at, multiplied across every open tab.
  // Urgent delivery is covered by web-push (PHA-1239); on returning to the tab
  // we reconnect immediately and the `init` event repaints the badge in full.
  useEffect(() => {
    if (typeof EventSource === "undefined") {
      const tick = () => { if (document.visibilityState === "visible") load(); };
      tick();
      const t = setInterval(tick, FALLBACK_POLL_MS);
      return () => clearInterval(t);
    }

    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    // Pending reconnect handle — MUST be cleared on cleanup, otherwise an
    // unmount mid-backoff lets the timer fire connectSSE() on a dead closure,
    // spawning an EventSource (and eventually a 45s poll loop) that nothing can
    // ever close — a detached leak that survives the component. (PHA-1267)
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;

    function cleanup() {
      es?.close();
      es = null;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    }

    function connectSSE() {
      const src = new EventSource("/api/notifications/stream");
      es = src;

      src.addEventListener("init", (e) => {
        retries = 0;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        applyFeed(JSON.parse((e as MessageEvent).data) as FeedPayload, false);
      });

      src.addEventListener("update", (e) => {
        applyFeed(JSON.parse((e as MessageEvent).data) as FeedPayload, true);
      });

      src.onerror = () => {
        src.close();
        if (es === src) es = null;
        retries++;
        if (retries <= 3) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectSSE();
          }, Math.min(retries * 3_000, 15_000));
        } else {
          load();
          if (!pollTimer) pollTimer = setInterval(load, FALLBACK_POLL_MS);
        }
      };
    }

    // Only hold a live stream while the tab is actually visible.
    function start() {
      if (!es && document.visibilityState === "visible") {
        retries = 0;
        connectSSE();
      }
    }
    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else cleanup();
    }

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cleanup();
    };
  }, [applyFeed, load]);

  // Auto-dismiss toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const earliest = Math.min(...toasts.map((t) => t.dismissAt));
    const delay = Math.max(0, earliest - Date.now()) + 50;
    const t = setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.dismissAt > Date.now()));
    }, delay);
    return () => clearTimeout(t);
  }, [toasts]);

  // Close dropdown on outside click or Escape
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

  // Per-item read on mousedown (fires before navigation). Event delegation via
  // the root div so cmd-click / middle-click also fire it on the originating tab.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      const link = target?.closest<HTMLAnchorElement>("a.notifbell-link");
      if (!link) return;
      const li = link.closest<HTMLLIElement>("li.notifbell-item");
      const id = li?.dataset.entryId;
      if (!id || !li?.classList.contains("fresh")) return;
      li.classList.remove("fresh");
      li.querySelector(".notifbell-dot")?.remove();
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, isNew: false, readAt: Date.now() } : x)));
      setUnread((n) => Math.max(0, n - 1));
      void postMarkOne(id);
    }
    const root = rootRef.current;
    if (!root) return;
    root.addEventListener("mousedown", onMouseDown);
    return () => root.removeEventListener("mousedown", onMouseDown);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((it) => ({ ...it, isNew: false, readAt: it.readAt ?? Date.now() })));
      await postMarkAll();
    }
  }

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
                  <li
                    key={it.id}
                    data-entry-id={it.id}
                    className={`notifbell-item${it.isNew ? " fresh" : ""}`}
                  >
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

      {/* In-app toast stack — new notifications that arrive via SSE (PHA-1241) */}
      {toasts.length > 0 && (
        <div className="notiftoast-stack" aria-live="polite" aria-atomic="false">
          {toasts.map((t) => (
            <a
              key={t.id}
              href={t.href}
              className="notiftoast"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            >
              <span className="notiftoast-icon" aria-hidden="true">{t.icon}</span>
              <span className="notiftoast-msg">{t.title}</span>
              <button
                type="button"
                className="notiftoast-close"
                aria-label="Dismiss notification"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >×</button>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
