"use client";

import { useEffect, useState } from "react";

/**
 * The signed-in user's shareable invite link, styled to the HEAT system.
 *
 * Share is the primary action — the native share sheet is the word-of-mouth
 * engine on mobile; copy is the desktop/manual fallback. Client-side so
 * /profile stays read-only on render (the code is minted lazily by the API on
 * first call).
 */
const SHARE_TEXT =
  "I'm calling the CS2 Major on HOTLINE — pick who goes 3-0, who busts, who lifts at IEM Cologne 2026. Get in:";

export function InviteLink() {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/invite")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { url: string }) => {
        if (!cancelled) setUrl(d.url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — the field is selectable as a fallback
    }
  }

  async function share() {
    if (!url) return;
    const nav = navigator as Navigator & {
      share?: (d: { title: string; text: string; url: string }) => Promise<void>;
    };
    if (nav.share) {
      await nav.share({ title: "HOTLINE", text: SHARE_TEXT, url }).catch(() => {});
    } else {
      copy();
    }
  }

  if (error) {
    return (
      <p style={{ color: "var(--ink-low)", fontSize: 12, margin: 0, fontFamily: "var(--font-mono)" }}>
        Couldn&apos;t load your invite link. Reload to retry.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Primary: native share — the word-of-mouth driver */}
      <button onClick={share} disabled={!url} className="btn-heat" style={{ width: "100%" }}>
        Share invite
        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
          <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
        </svg>
      </button>

      {/* Secondary: the raw link + copy (desktop / manual) */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "var(--surf-1)",
          border: "1px solid var(--hair-2)",
          padding: "8px 8px 8px 12px",
        }}
      >
        <input
          readOnly
          value={url ?? "Generating link…"}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            color: "var(--ink-mid)",
            fontSize: 12,
            letterSpacing: "0.02em",
            fontFamily: "var(--font-mono)",
            outline: "none",
          }}
        />
        <button
          onClick={copy}
          disabled={!url}
          style={{
            flexShrink: 0,
            background: copied ? "var(--tac-green)" : "transparent",
            color: copied ? "var(--void)" : "var(--ink-hi)",
            border: `1px solid ${copied ? "var(--tac-green)" : "var(--hair-3)"}`,
            padding: "7px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            cursor: url ? "pointer" : "default",
            transition: "all 150ms var(--ease)",
            minHeight: 32,
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
