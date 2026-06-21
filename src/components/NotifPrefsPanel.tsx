"use client";

/**
 * Per-type notification preference toggles (PHA-1240).
 *
 * Lets the player choose which notification types appear in the feed (in-app)
 * and whether stage lock reminders also go out as push notifications (push).
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
  pref: { inApp: boolean; push: boolean };
  showPush: boolean;
  disabled?: boolean;
  onToggle: (channel: PrefChannel) => void;
}

function PrefRow({ label, pref, showPush, disabled, onToggle }: RowProps) {
  return (
    <div className="notif-pref-row">
      <span className="notif-pref-label">{label}</span>
      <div className="notif-pref-chips">
        <button
          type="button"
          role="switch"
          aria-checked={pref.inApp}
          aria-label={`${label} in-app notifications`}
          disabled={disabled}
          className={`notif-chip${pref.inApp ? " on" : ""}`}
          onClick={() => onToggle("inApp")}
        >
          in-app
        </button>
        {showPush && (
          <button
            type="button"
            role="switch"
            aria-checked={pref.push}
            aria-label={`${label} push notifications`}
            disabled={disabled}
            className={`notif-chip${pref.push ? " on" : ""}`}
            onClick={() => onToggle("push")}
          >
            push
          </button>
        )}
      </div>
    </div>
  );
}

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
      <PrefRow
        label="Reactions"
        pref={prefs.reactions}
        showPush={false}
        onToggle={(ch) => toggle("reactions", ch)}
      />
      <PrefRow
        label="Stage reminders"
        pref={prefs.stage}
        showPush={hasPushSubscription}
        onToggle={(ch) => toggle("stage", ch)}
      />
      <PrefRow
        label="Recap"
        pref={prefs.recap}
        showPush={false}
        onToggle={(ch) => toggle("recap", ch)}
      />
      <PrefRow
        label="Announcements"
        pref={prefs.announce}
        showPush={false}
        onToggle={(ch) => toggle("announce", ch)}
      />
      <PrefRow
        label="Challenge coins"
        pref={prefs.coin}
        showPush={hasPushSubscription}
        onToggle={(ch) => toggle("coin", ch)}
      />
    </div>
  );
}
