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
      <button type="button" onClick={generate} disabled={loading} className="btn-ghost nf-btn-sm">
        {loading ? "Generating…" : "Generate login link"}
      </button>
    );
  }

  return (
    <div className="nf-stack">
      <div className="nf-inv">
        <input
          readOnly
          className="nf-code"
          aria-label="Your login link"
          value={loginUrl ?? ""}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" onClick={copy} className={`btn-solid${copied ? " is-copied" : ""}`}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button type="button" onClick={generate} disabled={loading} className="nf-textbtn">
        {loading ? "Regenerating…" : "↺ Regenerate link — invalidates the old one"}
      </button>
    </div>
  );
}
