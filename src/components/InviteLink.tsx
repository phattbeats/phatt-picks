"use client";

import { useEffect, useState } from "react";

/**
 * Fetches the current user's invite link (/api/invite) and offers copy / native
 * share. Client-side so /profile stays read-only on render (the code is minted
 * lazily by the API on first call).
 */
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
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) {
      await nav.share({ title: "phaTT Picks", text: "Join my phaTT Picks group for IEM Cologne 2026", url }).catch(() => {});
    } else {
      copy();
    }
  }

  if (error) {
    return <p style={{ color: "var(--text-low)", fontSize: "0.8125rem", margin: 0 }}>Couldn&apos;t load your invite link. Reload to retry.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "center",
          background: "var(--bg2)",
          border: "1px solid var(--bg3)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-2) var(--space-3)",
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
            color: "var(--text-mid)",
            fontSize: "0.8125rem",
            fontFamily: "monospace",
            outline: "none",
          }}
        />
        <button
          onClick={copy}
          disabled={!url}
          style={{
            flexShrink: 0,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "6px var(--space-3)",
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 700,
            fontSize: "0.75rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: url ? "pointer" : "default",
            minHeight: 32,
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button
        onClick={share}
        disabled={!url}
        style={{
          background: "transparent",
          border: "1px solid var(--bg3)",
          color: "var(--text-mid)",
          borderRadius: "var(--radius-md)",
          padding: "10px",
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: 600,
          fontSize: "0.875rem",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          cursor: url ? "pointer" : "default",
          minHeight: 44,
        }}
      >
        Share invite
      </button>
    </div>
  );
}
