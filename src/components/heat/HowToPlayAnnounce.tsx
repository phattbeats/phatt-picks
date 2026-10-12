"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * One-time, dismissable "how to play" nudge shown app-wide to every signed-in
 * user (#987). The dashboard's NEW HERE card only fired for players with
 * zero picks, so existing users never saw the explainer existed.
 * This shows once for everyone — until they open the guide or dismiss it — so
 * nobody misses it.
 *
 * "Seen" persists in localStorage (per-device, no schema/round-trip). Reading
 * the guide or hitting × both mark it seen. Bump SEEN_KEY's version to re-show
 * after a major rewrite. Renders nothing until mounted to avoid a hydration
 * flash, and nothing once seen.
 */
const SEEN_KEY = "hotline:howto-seen:v1";

export function HowToPlayAnnounce() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      // One-time gate read from localStorage on mount; setState here is intended.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!localStorage.getItem(SEEN_KEY)) setShow(true);
    } catch {
      // Storage blocked (private mode / disabled) — just don't show it.
    }
  }, []);

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <aside className="howto-nudge" aria-label="How to play">
      <Link href="/how-to-play" prefetch={false} onClick={markSeen} className="howto-nudge-link">
        <span className="howto-nudge-text">
          <span className="eyebrow">
            <b>New here</b> · 60 seconds
          </span>
          <span className="howto-nudge-t">First Pick&apos;Em? Start here.</span>
          <span className="howto-nudge-s">
            What you&apos;re calling, what 3–0 / advance / 0–3 mean, and how to lock your first picks.
          </span>
        </span>
        <span className="howto-nudge-go">Show me →</span>
      </Link>
      <button type="button" onClick={markSeen} aria-label="Dismiss" className="howto-nudge-x">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </aside>
  );
}
