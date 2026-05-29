"use client";

import { useState } from "react";

interface Props {
  /** Pass a numeric sectionId for Swiss; pass `"playoff"` for the bracket. */
  sectionId: number | "playoff";
  /** Any local autosave since the last successful sync surfaces a "needs sync" hint. */
  unsavedSinceSync: boolean;
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
  error?: string;
}

type Phase = "idle" | "syncing" | "result";

interface UIState {
  pill: string;
  pillTone: "ok" | "warn" | "error" | "info";
}

function describe(r: WriteResult | null, unsaved: boolean): UIState {
  if (!r) {
    return unsaved
      ? { pill: "Saved locally — not yet on Steam", pillTone: "info" }
      : { pill: "Saved locally", pillTone: "info" };
  }
  if (r.ok && !r.degraded && !r.escalate) {
    return { pill: `Synced to Steam (${r.synced} pick${r.synced === 1 ? "" : "s"})`, pillTone: "ok" };
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
  if (r.degraded) {
    return { pill: "Steam unavailable — saved locally", pillTone: "warn" };
  }
  if (r.escalate) {
    return { pill: `Sync error${r.status ? ` (${r.status})` : ""} — saved locally`, pillTone: "error" };
  }
  return { pill: "Saved locally", pillTone: "info" };
}

export function LockInStage({ sectionId, unsavedSinceSync, onSynced }: Props) {
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

  const state = describe(result, unsavedSinceSync);
  const toneColor: Record<UIState["pillTone"], string> = {
    ok: "var(--correct, #22c55e)",
    warn: "var(--accent)",
    error: "var(--accent)",
    info: "var(--text-mid)",
  };
  const label =
    phase === "syncing"
      ? "Locking in…"
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
          background: "var(--accent)",
          color: "#fff",
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
          width: "100%",
          minHeight: 44,
        }}
      >
        {label}
      </button>
    </div>
  );
}
