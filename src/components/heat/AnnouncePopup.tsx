"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NotifGlyph } from "./NotifGlyph";

/**
 * One-time broadcast popup (#1211 follow-up). When there's an active
 * announcement (see announcements-core), this shows it once as a little
 * dismissable popup so everyone actually sees it — the same message also lives
 * in the notification bell. "Seen" persists in localStorage keyed by the
 * announcement id, so a NEW announcement re-shows but a dismissed one stays
 * gone (per-device, no schema/round-trip). Renders nothing until mounted (avoids
 * a hydration flash) and nothing once dismissed.
 */

export interface PopupAnnouncement {
  id: string;
  icon: string;
  title: string;
  body: string;
  href: string;
}

export function AnnouncePopup({ announcement }: { announcement: PopupAnnouncement | null }) {
  const [show, setShow] = useState(false);
  const key = announcement ? `hotline:announce-seen:${announcement.id}` : null;

  useEffect(() => {
    if (!key) return;
    try {
      // One-time gate read from localStorage on mount; setState here is intended.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!localStorage.getItem(key)) setShow(true);
    } catch {
      /* storage blocked — just don't show */
    }
  }, [key]);

  function dismiss() {
    if (key) {
      try {
        localStorage.setItem(key, "1");
      } catch {
        /* ignore */
      }
    }
    setShow(false);
  }

  if (!announcement || !show) return null;

  return (
    <div className="announce-pop" role="status">
      <NotifGlyph kind="announcement" size="sm" />
      <div className="announce-pop-text">
        <span className="eyebrow">
          <b>Broadcast</b> · HOTLINE
        </span>
        <span className="announce-pop-title">{announcement.title}</span>
        <span className="announce-pop-body">{announcement.body}</span>
        <Link href={announcement.href} prefetch={false} className="announce-pop-cta" onClick={dismiss}>
          Take me there →
        </Link>
      </div>
      <button type="button" className="announce-pop-x" onClick={dismiss} aria-label="Dismiss">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
