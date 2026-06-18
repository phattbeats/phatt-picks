"use client";

/**
 * Header notification bell (PHA-1211 follow-up) — the universal in-app feed.
 *
 * Polls GET /api/notifications for the unread count + entries across kinds
 * (reactions on your picks, upcoming stage locks, your recap). The badge shows
 * unread; opening the dropdown marks everything seen (POST) and clears it.
 * Derived server-side from clock + rows — see notifications-core.
 *
 * Self-contained client component (owns its own fetch/poll). The parent only
 * mounts it when signed in.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface NotifStamp { id: string; glyph: string; label: string; kind: "props" | "heat"; count: number }
interface NotifEntry {
  id: string;
  kind: "reaction" | "stage" | "recap";
  icon: string;
  title: string;
  body: string;
  href: string;
  atMs: number;
  isNew: boolean;
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

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotifEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setUnread(typeof data.unread === "number" ? data.unread : 0);
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
      setUnread(0);
      setItems((prev) => prev.map((it) => ({ ...it, isNew: false })));
      try {
        await fetch("/api/notifications", { method: "POST" });
      } catch {
        /* will reconcile on next poll */
      }
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
          <div className="notifbell-head">NOTIFICATIONS</div>
          {!loaded ? (
            <div className="notifbell-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="notifbell-empty">You&apos;re all caught up.</div>
          ) : (
            <ul className="notifbell-list">
              {items.map((it) => (
                <li key={it.id} className={`notifbell-item${it.isNew ? " fresh" : ""}`}>
                  <Link href={it.href} className="notifbell-link" onClick={() => setOpen(false)}>
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
          )}
        </div>
      )}
    </div>
  );
}
