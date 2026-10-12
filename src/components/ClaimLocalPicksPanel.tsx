"use client";

import { useState } from "react";

/**
 * Steam-account-only: bring over picks made on a guest (local) account before
 * the user signed in with Steam. They paste the guest's login link (or raw
 * token) and we POST to /api/auth/local/claim, which moves those picks onto the
 * Steam account and retires the guest. See #1232.
 */
type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ok"; msg: string }
  | { kind: "err"; msg: string };

export function ClaimLocalPicksPanel() {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = value.trim();
    if (!token) return;
    setStatus({ kind: "working" });
    try {
      const res = await fetch("/api/auth/local/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        merged?: number;
        skipped?: number;
        from?: string;
        error?: string;
      };
      if (!res.ok) {
        setStatus({ kind: "err", msg: data.error ?? "Couldn't bring those picks over." });
        return;
      }
      const merged = data.merged ?? 0;
      const skipped = data.skipped ?? 0;
      const from = data.from ?? "your guest account";
      const skipNote = skipped > 0 ? ` (${skipped} skipped — already set here)` : "";
      setStatus({
        kind: "ok",
        msg:
          merged > 0
            ? `Brought over ${merged} pick${merged === 1 ? "" : "s"} from ${from}${skipNote}. Refreshing…`
            : `Nothing to move — every pick from ${from} was already on this account${skipNote}.`,
      });
      setValue("");
      // Let the server-rendered picks/leaderboard catch up.
      window.setTimeout(() => window.location.reload(), 1400);
    } catch {
      setStatus({ kind: "err", msg: "Network error — try again." });
    }
  }

  const working = status.kind === "working";

  return (
    <form onSubmit={submit} className="nf-stack">
      <div className="field">
        <label htmlFor="claimToken">Guest login link or token</label>
        <input
          id="claimToken"
          name="claimToken"
          type="text"
          className="input nf-input-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste your guest login link or token"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>
      <button type="submit" className="btn-ghost nf-btn-sm" disabled={working || !value.trim()}>
        {working ? "Bringing over…" : "Bring over my picks"}
      </button>
      {status.kind === "ok" && (
        <p className="nf-ok" role="status">
          <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {status.msg}
        </p>
      )}
      {status.kind === "err" && <p className="nf-err" role="alert">{status.msg}</p>}
    </form>
  );
}
