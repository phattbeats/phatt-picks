"use client";

/**
 * "Seal picks" — a player's opt-in HOTLINE commitment on one stage
 * (pick-lock-core). Deliberately NOT called "lock": the amber "Lock in & sync"
 * is the Valve push and "Locked" is the stage itself. Sealing freezes your calls
 * here and lets you choose who sees them before the stage locks:
 *
 *   Public — everyone can see your calls now.
 *   Hidden — revealed when the stage locks, like everyone else's.
 *
 * Hidden → public is offered afterwards; public is final and there is no unseal.
 * The confirm sheet spells that out before anything is written.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LockIcon } from "@/components/ui/LockIcon";
import type { SealView, SealVisibility } from "@/lib/pick-lock-core";

declare global {
  interface Window {
    __hlTrack?: (name: string, label?: string) => void;
  }
}

export function EyeIcon({ off = false, size = 14 }: { off?: boolean; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

const ERRORS: Record<string, string> = {
  stage_locked: "This stage has locked — there's nothing left to seal.",
  incomplete: "Make every call first — only a full set can be sealed.",
  already_sealed: "These picks are already sealed. Reload to see them.",
  public_is_final: "Public seals are final.",
  not_sealed: "Nothing sealed yet.",
  bad_origin: "Request blocked — reload and try again.",
};

/** Status line for the action bar once sealed. */
export function sealStatusText(seal: SealView): string {
  if (seal.steamDiverged) return "Sealed · changed in-game since";
  return seal.visibility === "public" ? "Sealed · everyone can see these calls" : "Sealed · hidden till the stage locks";
}

export function SealBadge({ seal }: { seal: SealView }) {
  const pub = seal.visibility === "public";
  return (
    <span className={`sgs-badge${pub ? " pub" : ""}`} title={pub ? "Everyone can see these calls" : "Revealed when the stage locks"}>
      <EyeIcon off={!pub} size={12} />
      Sealed · {pub ? "Public" : "Hidden"}
    </span>
  );
}

export function SealPicks({
  sectionId,
  stageLabel,
  total,
  ready,
  seal,
  onChange,
  steamLinked,
}: {
  /** Any section in the seal unit (a playoff round seals the whole bracket). */
  sectionId: number;
  stageLabel: string;
  total: number;
  /** Every slot holds a saved call. */
  ready: boolean;
  seal: SealView | null;
  onChange: (seal: SealView) => void;
  steamLinked: boolean;
}) {
  const [mode, setMode] = useState<"seal" | "public" | null>(null);

  if (seal) {
    return (
      <span className="sgs-ctl">
        <SealBadge seal={seal} />
        {seal.visibility === "hidden" && (
          <button type="button" className="btn-ghost sgs-btn" onClick={() => setMode("public")}>
            <EyeIcon size={14} />
            <span className="l">Make public</span>
            <span className="s">Go public</span>
          </button>
        )}
        {mode === "public" && (
          <SealSheet
            mode="public"
            sectionId={sectionId}
            stageLabel={stageLabel}
            total={total}
            steamLinked={steamLinked}
            onClose={() => setMode(null)}
            onDone={(s) => {
              setMode(null);
              onChange(s);
            }}
          />
        )}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn-ghost sgs-btn"
        onClick={() => setMode("seal")}
        disabled={!ready}
        title={ready ? "Seal these calls — then choose public or hidden" : "Make every call to seal"}
      >
        <LockIcon size={13} />
        <span className="l">Seal picks</span>
        <span className="s">Seal</span>
      </button>
      {mode === "seal" && (
        <SealSheet
          mode="seal"
          sectionId={sectionId}
          stageLabel={stageLabel}
          total={total}
          steamLinked={steamLinked}
          onClose={() => setMode(null)}
          onDone={(s) => {
            setMode(null);
            onChange(s);
          }}
        />
      )}
    </>
  );
}

function SealSheet({
  mode,
  sectionId,
  stageLabel,
  total,
  steamLinked,
  onClose,
  onDone,
}: {
  mode: "seal" | "public";
  sectionId: number;
  stageLabel: string;
  total: number;
  steamLinked: boolean;
  onClose: () => void;
  onDone: (seal: SealView) => void;
}) {
  const [choice, setChoice] = useState<SealVisibility>("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const visibility: SealVisibility = mode === "public" ? "public" : choice;
    try {
      const res = await fetch("/api/picks/seal", {
        method: mode === "public" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, visibility }),
      });
      const data = (await res.json().catch(() => ({}))) as { seal?: SealView; error?: string };
      if (!res.ok || !data.seal) {
        setError(ERRORS[data.error ?? ""] ?? `Couldn't seal (${res.status}). Try again.`);
        setBusy(false);
        return;
      }
      window.__hlTrack?.("pick_seal", mode === "public" ? "hidden_to_public" : visibility);
      onDone(data.seal);
    } catch {
      setError("Network error — try again.");
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="sgp-scrim" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div className="sgs-sheet" role="dialog" aria-modal="true" aria-labelledby="sgs-title">
        {mode === "seal" ? (
          <>
            <span className="eyebrow">
              Seal · <b>{stageLabel}</b>
            </span>
            <h2 id="sgs-title" className="display">
              Seal your calls
            </h2>
            <p>
              Sealing commits all {total} of your {stageLabel} calls.{" "}
              <b>You can&apos;t change them in HOTLINE after this</b> — even while the stage is still open.
            </p>
            <div className="sgs-opts" role="radiogroup" aria-label="Who can see your sealed calls">
              <button
                type="button"
                role="radio"
                aria-checked={choice === "public"}
                className={`sgs-opt${choice === "public" ? " on" : ""}`}
                onClick={() => setChoice("public")}
              >
                <span className="ic">
                  <EyeIcon size={18} />
                </span>
                <span className="tx">
                  <b>Public</b>
                  <span>Everyone can see your calls now.</span>
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={choice === "hidden"}
                className={`sgs-opt${choice === "hidden" ? " on" : ""}`}
                onClick={() => setChoice("hidden")}
              >
                <span className="ic">
                  <EyeIcon off size={18} />
                </span>
                <span className="tx">
                  <b>Hidden</b>
                  <span>Revealed when the stage locks.</span>
                </span>
              </button>
            </div>
            <p className="sgs-fine">
              Hidden can be switched to public later. Public is final, and a seal can&apos;t be undone.
              {steamLinked && (
                <>
                  {" "}
                  Steam stays the official record: if you change picks in the CS2 client after sealing,
                  HOTLINE keeps this set and marks it <b>changed in-game</b>.
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <span className="eyebrow">
              Sealed · hidden · <b>{stageLabel}</b>
            </span>
            <h2 id="sgs-title" className="display">
              Make your calls public
            </h2>
            <p>
              Everyone will see your {stageLabel} calls right away, before the stage locks.{" "}
              <b>This can&apos;t be switched back.</b>
            </p>
          </>
        )}
        {error && (
          <p className="sgs-err" role="alert">
            {error}
          </p>
        )}
        <div className="sgs-act">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-solid" onClick={submit} disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Sealing…" : mode === "public" ? "Make public" : choice === "public" ? "Seal · public" : "Seal · hidden"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
