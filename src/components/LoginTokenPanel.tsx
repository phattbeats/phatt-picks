"use client";

import { useState } from "react";

/**
 * Shows a local player's cross-device login link.
 * Generates one on first use; lets the player regenerate to invalidate the old link.
 */
export function LoginTokenPanel({ initialToken }: { initialToken: string | null }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loginUrl = token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/auth/token-login?t=${token}`
    : null;

  async function generate() {
    setLoading(true);
    try {
      const r = await fetch("/api/auth/local/token", { method: "POST" });
      if (r.ok) {
        const d = await r.json() as { token: string };
        setToken(d.token);
      }
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!loginUrl) return;
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: input is selectable
    }
  }

  if (!token) {
    return (
      <button
        onClick={generate}
        disabled={loading}
        className="btn-ghost"
        style={{ width: "100%", justifyContent: "center" }}
      >
        {loading ? "Generating…" : "Generate login link"}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
          value={loginUrl ?? ""}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            color: "var(--ink-mid)",
            fontSize: 11,
            letterSpacing: "0.02em",
            fontFamily: "var(--font-mono)",
            outline: "none",
          }}
        />
        <button
          onClick={copy}
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
            cursor: "pointer",
            transition: "all 150ms var(--ease)",
            minHeight: 32,
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button
        onClick={generate}
        disabled={loading}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-low)",
          cursor: loading ? "default" : "pointer",
          textAlign: "left",
        }}
      >
        {loading ? "Regenerating…" : "↺ Regenerate link — invalidates the old one"}
      </button>
    </div>
  );
}
