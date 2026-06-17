"use client";

/**
 * The Bleachers strip (PHA-1211, concept A) — renders under a single revealed
 * pick on a player's profile. Shows the anonymous running tally of reaction
 * stamps and, for a signed-in viewer who isn't the profile owner, a drop row to
 * add/swap their own stamp. Senders are masked until the stage resolves; the
 * `unmasked` flag flips the footer copy once the tape has dropped.
 *
 * Optimistic: a drop updates the local tally immediately, then reconciles with
 * the server's authoritative tally. One stamp per viewer per pick — tapping a
 * different stamp swaps; tapping your active stamp again clears it (toggle).
 */

import { useState, useTransition } from "react";
import { STAMPS } from "@/lib/bleachers-core";

export interface TallyLine {
  id: string;
  glyph: string;
  label: string;
  kind: "props" | "heat";
  count: number;
  mine: boolean;
}

export function BleachersStrip({
  targetPlayerId,
  sectionId,
  groupId,
  slotIndex,
  initialTally,
  canReact,
  unmasked,
}: {
  targetPlayerId: string;
  sectionId: number;
  groupId: number;
  slotIndex: number;
  initialTally: TallyLine[];
  /** signed in AND not viewing own profile */
  canReact: boolean;
  /** stage resolved → senders named (footer copy only for now) */
  unmasked: boolean;
}) {
  const [tally, setTally] = useState<TallyLine[]>(initialTally);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const myStampId = tally.find((t) => t.mine)?.id ?? null;
  const total = tally.reduce((n, t) => n + t.count, 0);

  function drop(stampId: string) {
    if (!canReact || pending) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetPlayerId, sectionId, groupId, slotIndex, stampId }),
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data.tally)) setTally(data.tally as TallyLine[]);
      } catch {
        /* network hiccup — leave the tally as-is */
      }
      setOpen(false);
    });
  }

  return (
    <div className="bleachers">
      <div className="bleachers-head">
        <span className="bleachers-eyebrow">THE BLEACHERS</span>
        {total > 0 && <span className="bleachers-count">{total}</span>}
      </div>

      {tally.length > 0 ? (
        <div className="bleachers-tally">
          {tally.map((t) => (
            <span
              key={t.id}
              className={`bleach-stamp${t.mine ? " mine" : ""} ${t.kind}`}
              title={t.mine ? "You dropped this" : undefined}
            >
              <span className="bleach-glyph">{t.glyph}</span>
              <span className="bleach-ct">{t.count}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="bleachers-empty">No reactions yet. Be the first to talk.</div>
      )}

      {canReact && (
        <div className="bleachers-drop">
          {!open ? (
            <button type="button" className="bleach-add" onClick={() => setOpen(true)} disabled={pending}>
              {myStampId ? "Change your stamp" : "+ Drop a stamp"}
            </button>
          ) : (
            <div className="bleach-options">
              {STAMPS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`bleach-opt ${s.kind}${myStampId === s.id ? " active" : ""}`}
                  onClick={() => drop(s.id)}
                  disabled={pending}
                  title={s.label}
                >
                  <span className="bleach-glyph">{s.glyph}</span>
                  <span className="bleach-opt-lbl">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bleachers-foot">
        {unmasked
          ? "The tape dropped — tap a stamp to see who called it."
          : "Anonymous until the stage resolves. Then the masks come off."}
      </div>
    </div>
  );
}
