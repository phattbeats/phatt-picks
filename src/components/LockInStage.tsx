"use client";

import { useState, type ReactNode } from "react";
import { ActionBar, type BarTone } from "@/components/sg/picks/ActionBar";

interface Props {
  /** Pass a numeric sectionId for Swiss; pass `"playoff"` for the bracket. */
  sectionId: number | "playoff";
  /** Any local autosave since the last successful sync surfaces a "needs sync" hint. */
  unsavedSinceSync: boolean;
  /**
   * Server-derived on first render: true when every pick this section holds is
   * already on Steam (no `isLocal` rows). Lets the button render green on page
   * load — and stay green across reloads — until the player makes a change,
   * without waiting for an in-session sync click (#1214 follow-up).
   */
  initiallySynced?: boolean;
  onSynced: () => void;
  /**
   * Swiss board (Singapore §3): render as the sticky action bar with this
   * progress. The CTA stays disabled until every slot is filled, then reads
   * "Lock in & sync". Omit for the inline card (playoff bracket picker).
   */
  progress?: { filled: number; total: number };
  /** Per-slot autosave status from the board (saving / failed) — wins over the sync state. */
  localStatus?: { text: string; tone: BarTone } | null;
  /**
   * A second action rendered beside the Steam CTA — the HOTLINE "Seal picks"
   * control (SealPicks). Kept separate so the Valve push stays its own button.
   */
  secondary?: ReactNode;
}

type WriteSkip = "write-disabled" | "no-steam-id" | "no-auth-code" | "no-picks" | "pickem-not-open";

interface WriteResult {
  ok: boolean;
  synced: number;
  skipped?: WriteSkip;
  degraded?: boolean;
  escalate?: boolean;
  status?: number;
  error?: string; // #853: Valve response body for non-200, surfaced into the pill
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
    // the button stays green across reloads (#1214 follow-up).
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
  // Pre-open (route 409 `pickem_not_open`, or the library skip).
  if (r.skipped === "pickem-not-open" || r.error === "pickem_not_open") {
    return { pill: "Available when Pick'Em opens", pillTone: "info" };
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

const TONE_CLASS: Record<UIState["pillTone"], BarTone> = {
  ok: "ok",
  warn: "warn",
  error: "err",
  info: "info",
};

export function LockInStage({
  sectionId,
  unsavedSinceSync,
  initiallySynced = false,
  onSynced,
  progress,
  localStatus,
  secondary,
}: Props) {
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
  // Green once everything the player has picked is on Steam; amber CTA the
  // moment there are local changes still to push. #1214.
  const isSynced = state.pillTone === "ok";
  const syncing = phase === "syncing";

  if (progress) {
    const { filled, total } = progress;
    const ready = filled >= total;
    // A sync attempt that came back skipped / degraded / failed keeps its
    // explanatory line; otherwise the bar speaks in board terms.
    const failedSync = !!result && !(result.ok && !result.degraded && !result.escalate);
    let text: string;
    let tone: BarTone;
    if (syncing) {
      text = "Syncing to Steam…";
      tone = "info";
    } else if (localStatus) {
      text = localStatus.text;
      tone = localStatus.tone;
    } else if (failedSync) {
      text = state.pill;
      tone = TONE_CLASS[state.pillTone];
    } else if (isSynced) {
      text = `✓ ${state.pill}`;
      tone = "ok";
    } else {
      text = ready ? "All calls made" : "Saved · local";
      tone = "info";
    }

    const cta = syncing ? (
      <button type="button" className="btn-heat" disabled aria-busy="true">
        Locking in…
      </button>
    ) : isSynced ? (
      <button type="button" className="btn-ghost" onClick={onClick} disabled={!ready}>
        Synced ✓
      </button>
    ) : ready ? (
      <button type="button" className="btn-heat" onClick={onClick}>
        Lock in &amp; sync
      </button>
    ) : (
      <button type="button" className="btn-ghost" disabled>
        {total - filled} to go
      </button>
    );

    return (
      <ActionBar
        filled={filled}
        total={total}
        state={text}
        tone={tone}
        cta={
          secondary ? (
            <div className="sgp-ctas">
              {secondary}
              {cta}
            </div>
          ) : (
            cta
          )
        }
      />
    );
  }

  const label = syncing
    ? "Locking in…"
    : isSynced
      ? sectionId === "playoff"
        ? "Playoffs Synced ✓"
        : "Synced to Steam ✓"
      : sectionId === "playoff"
        ? "Lock In Playoffs to Steam"
        : "Lock In to Steam";

  return (
    <div className="sgp-lockcard">
      <span className={`s ${TONE_CLASS[state.pillTone]}`} aria-live="polite">
        {state.pill}
      </span>
      <button
        type="button"
        onClick={onClick}
        disabled={syncing}
        aria-busy={syncing || undefined}
        className={isSynced ? "btn-ghost" : "btn-heat"}
      >
        {label}
      </button>
      {secondary}
    </div>
  );
}
