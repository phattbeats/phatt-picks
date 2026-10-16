"use client";

/**
 * The Bleachers strip (#1211, concept A) — renders under a single revealed
 * pick (profile, compare, locked board). Shows the anonymous running tally of
 * reaction stamps and, for a signed-in viewer who isn't the pick's owner, a
 * small "React" trigger that opens the fixed stamp vocabulary. Senders stay
 * masked until the stage resolves (enforced server-side / in bleachers-core).
 *
 * Quiet but clear (Brandon): small, low-contrast chips that brighten on
 * hover/focus; the trigger is a labelled smiley so it obviously means "react";
 * YOUR stamp is the filled chip (everyone else's are outlined); every chip
 * carries a tooltip + aria label saying what it is. Visual size is small, the
 * hit area is ≥40px (see .bleach-* in globals.css).
 *
 * Optimistic: a drop updates the local tally immediately, then reconciles with
 * the server's authoritative tally (or rolls back on failure). One stamp per
 * viewer per pick — tapping a different stamp swaps it; tapping someone else's
 * chip drops that same stamp.
 */

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { STAMPS } from "@/lib/bleachers-core";

export interface TallyLine {
  id: string;
  glyph: string;
  label: string;
  kind: "props" | "heat";
  count: number;
  mine: boolean;
}

/** Local optimistic swap: move the viewer's single stamp to `stampId`. */
function applyDrop(tally: TallyLine[], stampId: string): TallyLine[] {
  const next = tally
    .map((t) => (t.mine ? { ...t, count: t.count - 1, mine: false } : t))
    .filter((t) => t.count > 0);
  const hit = next.find((t) => t.id === stampId);
  if (hit) return next.map((t) => (t.id === stampId ? { ...t, count: t.count + 1, mine: true } : t));
  const s = STAMPS.find((x) => x.id === stampId);
  return s ? [...next, { id: s.id, glyph: s.glyph, label: s.label, kind: s.kind, count: 1, mine: true }] : next;
}

function titleCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

function chipLabel(t: TallyLine, canReact: boolean): string {
  const who = t.mine
    ? t.count > 1
      ? `you and ${t.count - 1} other${t.count - 1 !== 1 ? "s" : ""}`
      : "you"
    : `${t.count} player${t.count !== 1 ? "s" : ""}`;
  const tail = t.mine ? "Your reaction." : canReact ? "Tap to add yours." : "";
  return `${titleCase(t.label)} from ${who}. Names stay hidden until the stage resolves. ${tail}`.trim();
}

const FAIL_COPY: Record<string, string> = {
  "rate-limited": "Easy — one reaction every few seconds.",
  resolved: "This stage is settled. Reactions are closed.",
  "not-revealed": "This pick isn't public yet.",
};

export function BleachersStrip({
  targetPlayerId,
  sectionId,
  groupId,
  slotIndex,
  initialTally,
  canReact,
}: {
  targetPlayerId: string;
  sectionId: number;
  groupId: number;
  slotIndex: number;
  initialTally: TallyLine[];
  /** signed in AND not viewing own pick */
  canReact: boolean;
}) {
  const [tally, setTally] = useState<TallyLine[]>(initialTally);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ text: string; err: boolean }>({ text: "", err: false });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const mine = tally.find((t) => t.mine) ?? null;

  // Menu: focus the first option on open; Esc / outside tap closes and hands
  // focus back to the trigger.
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>(".bleach-opt")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  function drop(stampId: string) {
    if (!canReact || pending) return;
    if (mine?.id === stampId) {
      setOpen(false);
      return;
    }
    const before = tally;
    setTally(applyDrop(tally, stampId));
    setOpen(false);
    setStatus({ text: "", err: false });
    triggerRef.current?.focus();
    startTransition(async () => {
      try {
        const res = await fetch("/api/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetPlayerId, sectionId, groupId, slotIndex, stampId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.tally)) {
          setTally(data.tally as TallyLine[]);
          const s = STAMPS.find((x) => x.id === stampId);
          if (s) setStatus({ text: `Reacted ${titleCase(s.label)}.`, err: false });
        } else {
          setTally(before);
          setStatus({ text: FAIL_COPY[data.reason as string] ?? "Couldn't save that. Try again.", err: true });
        }
      } catch {
        setTally(before);
        setStatus({ text: "Couldn't save that. Try again.", err: true });
      }
    });
  }

  // Nothing to show: no reactions and the viewer can't add one.
  if (tally.length === 0 && !canReact) return null;

  return (
    <div className={`bleachers${open ? " open" : ""}`} ref={rootRef}>
      {tally.map((t) => {
        const label = chipLabel(t, canReact);
        const cls = `bleach-stamp${t.mine ? " mine" : ""}`;
        const inner = (
          <>
            <span className="bleach-glyph" aria-hidden>
              {t.glyph}
            </span>
            <span className="bleach-ct">{t.count}</span>
          </>
        );
        return canReact ? (
          <button
            key={t.id}
            type="button"
            className={cls}
            title={label}
            aria-label={label}
            aria-pressed={t.mine}
            onClick={() => drop(t.id)}
            disabled={pending}
          >
            {inner}
          </button>
        ) : (
          <span key={t.id} className={cls} title={label} role="img" aria-label={label}>
            {inner}
          </span>
        );
      })}

      {canReact && (
        <button
          ref={triggerRef}
          type="button"
          className="bleach-add"
          onClick={() => setOpen((o) => !o)}
          disabled={pending}
          aria-expanded={open}
          aria-controls={menuId}
          title={mine ? `Change your reaction (now: ${titleCase(mine.label)})` : "React to this pick — anonymous until the stage resolves"}
          data-tip="react"
        >
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="9" cy="10" r="6.5" />
            <path d="M6.6 11.8c.6.9 1.4 1.3 2.4 1.3s1.8-.4 2.4-1.3" />
            <path d="M6.8 8.2h.01M11.2 8.2h.01" strokeWidth="2" />
            <path d="M16.5 2.5v4M14.5 4.5h4" />
          </svg>
          <span className="bleach-add-t">{mine ? "Change" : "React"}</span>
        </button>
      )}

      {canReact && open && (
        <div className="bleach-options" id={menuId} role="group" aria-label="Choose a reaction">
          {STAMPS.map((s) => {
            const active = mine?.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                className={`bleach-opt${active ? " active" : ""}`}
                onClick={() => drop(s.id)}
                disabled={pending}
                aria-pressed={active}
                title={active ? "Your current reaction" : `React ${titleCase(s.label)}`}
              >
                <span className="bleach-glyph" aria-hidden>
                  {s.glyph}
                </span>
                <span className="bleach-opt-lbl">{s.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Success is announced only; a failure is shown too (it rolled back). */}
      <span className={status.err ? "bleach-msg" : "rk-sr"} role="status" aria-live="polite">
        {status.text}
      </span>
    </div>
  );
}
