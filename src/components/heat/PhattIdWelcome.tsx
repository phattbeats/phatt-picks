"use client";

/**
 * PHATT ID welcome (PHA-4477, Brandon 2026-10-24): the first time a Cologne-era
 * player comes back after achievements launched, a little card explains PHATT
 * ID and hands them what they earned retroactively: the achievements (as pins)
 * and the XP banked. The level number stays hidden until PHATT ID sign-in is
 * live, so it shows XP, never a level.
 *
 * "Seen" is per account, not per device: dismissing it marks the feed's
 * `ach:launch` roll-up entry read (POST /api/notifications), which is also what
 * the server checks before rendering this — so the bell and the card agree.
 * While it's up, the layout holds back the broadcast popup so they never stack.
 */

import Link from "next/link";
import { useState } from "react";
import { ACHIEVEMENT_BY_KEY, type AchievementKey } from "@/lib/progression-core";
import { TrinketPin } from "@/components/sg/people/Achievements";

export function PhattIdWelcome({
  entryId,
  majors,
  keys,
  xp,
  profileHref,
}: {
  entryId: string;
  /** Majors the retroactive haul came from, e.g. ["IEM Cologne 2026"]. */
  majors: string[];
  keys: AchievementKey[];
  xp: number;
  profileHref: string;
}) {
  const [show, setShow] = useState(true);

  const markSeen = () => {
    setShow(false);
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read", entryId }),
    }).catch(() => {});
  };

  if (!show) return null;
  const where = majors.length === 1 ? majors[0] : "earlier Majors";
  const n = keys.length;

  return (
    <div className="announce-pop pid-pop" role="dialog" aria-labelledby="pid-pop-title">
      <span className="pid-pop-mark" aria-hidden="true">ID</span>
      <div className="announce-pop-text">
        <span className="eyebrow">
          <b>PHATT ID</b> · New on HOTLINE
        </span>
        <span className="announce-pop-title" id="pid-pop-title">
          Your {majors.length === 1 ? majors[0].replace(/\s+\d{4}$/, "") : "past"} calls count
        </span>
        <span className="announce-pop-body">
          HOTLINE is part of PHATT ID now: one account that levels up across the PHATT arcade. We went back over{" "}
          {where} and credited what you earned.
        </span>
        <div className="pid-pop-stats">
          <span>
            <b>{n}</b> achievement{n === 1 ? "" : "s"}
          </span>
          <span>
            <b>{xp.toLocaleString("en-US")}</b> XP
          </span>
        </div>
        <ul className="ach-row pid-pop-pins" aria-label="Your pins">
          {keys.map((k) => {
            const def = ACHIEVEMENT_BY_KEY.get(k);
            return def ? (
              <li key={k} title={`${def.name} · ${def.trinket}`}>
                <TrinketPin def={def} earned size={32} />
              </li>
            ) : null;
          })}
        </ul>
        <span className="announce-pop-body pid-pop-fine">
          Each achievement drops a pin and a banner photo for your profile. XP unlocks new case felts as you level up.
          All cosmetic: your points never change.
        </span>
        <span className="pid-pop-ctas">
          <Link href={`${profileHref}#achievements`} prefetch={false} className="announce-pop-cta" onClick={markSeen}>
            See my achievements →
          </Link>
          <Link href="/settings#customize" prefetch={false} className="announce-pop-cta" onClick={markSeen}>
            Customize
          </Link>
        </span>
      </div>
      <button type="button" className="announce-pop-x" onClick={markSeen} aria-label="Dismiss">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
