"use client";

import { useState } from "react";

import { extractLoginToken } from "@/lib/local-merge-core";

/**
 * Lets a returning local player sign back in from another device by pasting
 * their login token (or the full login link). We extract the `t=` value if a
 * URL is pasted, otherwise treat the input as the raw token, then hand off to
 * GET /api/auth/token-login which validates, mints a session, and redirects.
 */
export function TokenSignInPanel() {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = extractLoginToken(value);
    if (!token) return;
    setSubmitting(true);
    window.location.href = `/api/auth/token-login?t=${encodeURIComponent(token)}`;
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label
        htmlFor="loginToken"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--ink-low)",
        }}
      >
        Login token or link
      </label>
      <input
        id="loginToken"
        name="loginToken"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste your login link or token"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        style={{
          background: "var(--surf-2)",
          border: "1px solid var(--hair-2)",
          padding: "12px 14px",
          color: "var(--ink-hi)",
          fontSize: 14,
          fontFamily: "var(--font-mono)",
          minHeight: 44,
          outline: "none",
          borderRadius: "var(--r-sm)",
        }}
      />
      <button
        type="submit"
        className="btn-ghost"
        disabled={submitting || !value.trim()}
        style={{ width: "100%", justifyContent: "center" }}
      >
        {submitting ? "Signing in…" : "Resume my session"}
      </button>
    </form>
  );
}
