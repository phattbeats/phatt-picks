"use client";

import { useState } from "react";

interface Props {
  /** Pass a numeric sectionId for Swiss; pass `"playoff"` for the bracket. */
  sectionId: number | "playoff";
  /** Any local autosave since the last successful sync surfaces a "needs sync" hint. */
  unsavedSinceSync: boolean;
  /**
   * Server-derived on first render: true when every pick this section holds is
   * already on Steam (no `isLocal` rows). Lets the button render green on page
   * load — and stay green across reloads — until the player makes a change,
   * without waiting for an in-session sync click (PHA-1214 follow-up).
   */
  initiallySynced?: boolean;
  onSynced: () => void;
}

type WriteSkip = "write-disabled" | "no-steam-id" | "no-auth-code" | "no-picks";

interface WriteResult {
  ok: boolean;
  synced: number;
  skipped?: WriteSkip;
  degraded?: boolean;
  escalate?: boolean;
  status?: number;
  error?: string; // PHA-853: Valve response body for non-200, surfaced into the pill
}

type Phase = "idle" | "syncing" | "result";

interface UIState {
  pill: string;
  pillTone: "ok" | "warn" | "error" | "info";
}

function describe(r: WriteResult | null, unsaved: boolean, initiallySynced: boolean): UIState {
  if (!r) {
    // No sync click this session (e.g. a fresh page load). Local edits always
    // win → yellow. Otherwise honor the server's "already on Steam" signal so
    // the button stays green across reloads (PHA-1214 follow-up).
    if (unsaved) return { pill: "Saved locally — not yet on Steam", pillTone: "warn" };
    if (initiallySynced) return { pill: "Synced to Steam", pillTone: "ok" };
    return { pill: "Saved locally", pillTone: "info" };
  }
  if (r.ok && !r.degraded && !r.escalate) {
    // A prior sync fully succeeded — but only call it "synced" while nothing
    // has changed since. Any local edit since then means there are picks not
    // yet on Steam, so fall back to the yellow "needs sync" state.
    return unsaved
      ? { pill: "Saved locally — not yet on Steam", pillTone: "warn" }
      : { pill: `Synced to Steam (${r.synced} pick${r.synced === 1 ? "" : "s"})`, pillTone: "ok" };
  }
  if (r.skipped === "no-auth-code") {
    return { pill: "Add your Steam auth code to sync", pillTone: "warn" };
  }
  if (r.skipped === "write-disabled") {
    return { pill: "Steam sync disabled by owner", pillTone: "info" };
  }
  if (r.skipped === "no-picks") {
    return { pill: "Make some picks first", pillTone: "info" };
  }
  if (r.skipped === "no-steam-id") {
    return { pill: "Steam account not linked", pillTone: "warn" };
  }
  // Partial success: some picks landed before the failure. Lead with the
  // synced count so the pill doesn't read as a total wipeout when 8/10 worked.
  const partial = r.synced > 0 ? `${r.synced} synced · ` : "";
  if (r.degraded) {
    const detail = r.error ? ` (${r.error.slice(0, 80)})` : "";
    return {
      pill: `${partial}Steam unavailable — saved locally${detail}`,
      pillTone: "warn",
    };
  }
  if (r.escalate) {
    const detail = r.error ? ` — ${r.error}` : "";
    return {
      pill: `${partial}Sync error${r.status ? ` (${r.status})` : ""}${detail}`,
      pillTone: "error",
    };
  }
  return { pill: "Saved locally", pillTone: "info" };
}

export function LockInStage({ sectionId, unsavedSinceSync, initiallySynced = false, onSynced }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<WriteResult | null>(null);

  const onClick = async () => {
    setPhase("syncing");
    try {
      const body = sectionId === "playoff" ? { playoff: true } : { sectionId };
      const res = await fetch("/api/picks/sync-stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as WriteResult;
      setResult(data);
      setPhase("result");
      if (data.ok && !data.degraded && !data.escalate) {
        onSynced();
      }
    } catch {
      setResult({
        ok: false,
        synced: 0,
        escalate: true,
        error: "network",
      });
      setPhase("result");
    }
  };

  const state = describe(result, unsavedSinceSync, initiallySynced);
  const toneColor: Record<UIState["pillTone"], string> = {
    ok: "var(--correct, #22c55e)",
    warn: "var(--accent)",
    error: "var(--accent)",
    info: "var(--text-mid)",
  };
  // Green once everything the player has picked is on Steam; yellow (the accent
  // call-to-action) the moment there are local changes still to push. PHA-1214.
  const isSynced = state.pillTone === "ok";
  const label =
    phase === "syncing"
      ? "Locking in…"
      : isSynced
        ? sectionId === "playoff"
          ? "Playoffs Synced ✓"
          : "Synced to Steam ✓"
        : sectionId === "playoff"
          ? "Lock In Playoffs to Steam"
          : "Lock In to Steam";

  return (
    <div
      style={{
        background: "var(--bg1)",
        border: "1px solid var(--bg3)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <span
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: "0.6875rem",
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: toneColor[state.pillTone],
          }}
        >
          {state.pill}
        </span>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={phase === "syncing"}
        style={{
          background: isSynced ? "var(--tac-green)" : "var(--accent)",
          color: isSynced ? "var(--void)" : "#fff",
          borderRadius: "var(--radius-md)",
          padding: "12px",
          border: "none",
          cursor: phase === "syncing" ? "wait" : "pointer",
          textAlign: "center",
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: 700,
          fontSize: "1rem",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          opacity: phase === "syncing" ? 0.75 : 1,
          transition: "background 250ms var(--ease), color 250ms var(--ease)",
          width: "100%",
          minHeight: 44,
        }}
      >
        {label}
      </button>
    </div>
  );
}
