"use client";

/**
 * Per-type notification preference toggles (#1240).
 *
 * Lets the player choose, per kind, whether it appears in the feed (in-app) and
 * whether it also goes out as a push notification (push — shown once this
 * device has a push subscription; every push sender honours the per-kind flag).
 * Optimistic-UI: the toggle flips immediately; the PATCH fires in the background.
 * Saves to GET/PATCH /api/notifications/prefs.
 */

import { useState, useTransition } from "react";
import type { NotifPrefs } from "@/lib/notifications-core";

interface Props {
  initialPrefs: NotifPrefs;
  hasPushSubscription: boolean;
}

type PrefKind = keyof NotifPrefs;
type PrefChannel = "inApp" | "push";

async function savePrefs(prefs: NotifPrefs) {
  try {
    await fetch("/api/notifications/prefs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefs }),
    });
  } catch {
    /* reconcile on next page load */
  }
}

interface RowProps {
  label: string;
  hint: string;
  pref: { inApp: boolean; push: boolean };
  showPush: boolean;
  disabled?: boolean;
  onToggle: (channel: PrefChannel) => void;
}

/** A Singapore `.sw` switch — a real <button role="switch"> so it keeps
 *  keyboard + screen-reader semantics. */
function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`sw nf-sw${on ? " on" : ""}`}
      onClick={onClick}
    />
  );
}

function PrefRow({ label, hint, pref, showPush, disabled, onToggle }: RowProps) {
  return (
    <div className="row notif-pref-row">
      <div className="notif-pref-label">
        <div className="t">{label}</div>
        <div className="s">{hint}</div>
      </div>
      <div className={`notif-pref-sws${showPush ? " two" : ""}`}>
        <Switch
          on={pref.inApp}
          label={`${label} in-app notifications`}
          disabled={disabled}
          onClick={() => onToggle("inApp")}
        />
        {showPush && (
          <Switch
            on={pref.push}
            label={`${label} push notifications`}
            disabled={disabled}
            onClick={() => onToggle("push")}
          />
        )}
      </div>
    </div>
  );
}

const ROWS: ReadonlyArray<{ kind: PrefKind; label: string; hint: string }> = [
  { kind: "stage", label: "Stage locks", hint: "24 hours and 1 hour before picks lock" },
  { kind: "recap", label: "Stage results", hint: "When your recap is ready" },
  { kind: "reactions", label: "Reactions", hint: "When someone stamps one of your picks" },
  { kind: "coin", label: "Coin minted", hint: "When a Major concludes" },
  { kind: "announce", label: "Broadcasts", hint: "The occasional word from HOTLINE" },
];

export function NotifPrefsPanel({ initialPrefs, hasPushSubscription }: Props) {
  const [prefs, setPrefs] = useState<NotifPrefs>(initialPrefs);
  const [, startTransition] = useTransition();

  function toggle(kind: PrefKind, channel: PrefChannel) {
    const next: NotifPrefs = {
      ...prefs,
      [kind]: { ...prefs[kind], [channel]: !prefs[kind][channel] },
    };
    setPrefs(next);
    startTransition(() => {
      void savePrefs(next);
    });
  }

  return (
    <div className="notif-prefs">
      <div className="notif-prefs-head" aria-hidden="true">
        <span />
        <span className={`notif-pref-sws${hasPushSubscription ? " two" : ""}`}>
          <span>In-app</span>
          {hasPushSubscription && <span>Push</span>}
        </span>
      </div>
      {ROWS.map((r) => (
        <PrefRow
          key={r.kind}
          label={r.label}
          hint={r.hint}
          pref={prefs[r.kind]}
          showPush={hasPushSubscription}
          onToggle={(ch) => toggle(r.kind, ch)}
        />
      ))}
    </div>
  );
}
