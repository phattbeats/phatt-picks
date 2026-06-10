"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * One-time, dismissable "how to play" nudge shown app-wide to every signed-in
 * user (PHA-987). The dashboard's [ NEW_HERE ] card only fired for players with
 * zero picks, so existing users (e.g. phaTT) never saw the explainer existed.
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
    <div
      className="brk"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--surf-1)",
        border: "1px solid var(--hair-2)",
        borderLeft: "3px solid var(--heat)",
        padding: "14px 14px 14px 16px",
        marginBottom: 16,
      }}
    >
      <span className="br-tr" />
      <span className="br-bl" />
      <Link
        href="/how-to-play"
        onClick={markSeen}
        style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, textDecoration: "none" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="eyebrow-mono" style={{ display: "block", marginBottom: 5 }}>
            [ NEW_HERE ]
          </span>
          <p style={{ margin: 0, color: "var(--ink-hi)", fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>
            First Pick&apos;Em? Read the 60-second rundown.
          </p>
          <p style={{ margin: "3px 0 0", color: "var(--ink-mid)", fontSize: 12, lineHeight: 1.45 }}>
            What you&apos;re predicting, what 3-0 / advance / 0-3 mean, and how to make your first picks.
          </p>
        </div>
        <span style={{
          flexShrink: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--heat)",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}>
          Show me
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="var(--heat)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </Link>
      <button
        type="button"
        onClick={markSeen}
        aria-label="Dismiss"
        style={{
          flexShrink: 0,
          alignSelf: "flex-start",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 4,
          margin: -4,
          color: "var(--ink-low)",
          lineHeight: 0,
        }}
      >
        <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
