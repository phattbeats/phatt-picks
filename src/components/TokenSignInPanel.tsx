"use client";

import { useState } from "react";

import { extractLoginToken } from "@/lib/local-merge-core";

/**
 * Lets a returning local player sign back in from another device by pasting
 * their login token (or the full login link). We extract the `t=` value if a
 * URL is pasted, otherwise treat the input as the raw token, then hand off to
 * GET /api/auth/token-login which validates, mints a session, and redirects.
 * Styled by `.sg-token` in sg-auth.css.
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
    <form onSubmit={submit} className="sg-token">
      <label htmlFor="loginToken" className="vh">
        Login token or link
      </label>
      <input
        id="loginToken"
        name="loginToken"
        type="text"
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste your login link or token"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <button type="submit" className="btn-ghost" disabled={submitting || !value.trim()}>
        {submitting ? "Signing in…" : "Resume my session"}
      </button>
    </form>
  );
}
