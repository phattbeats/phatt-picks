"use client";

/**
 * App-wide host for the coach-mark registry (lib/coach-core COACH_TIPS).
 * Mounted once in the (app) layout. Decides this device's audience on first
 * visit, then mounts a <CoachMark> for every tip eligible on the current
 * route — the store shows one at a time, in registry order.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { COACH_TIPS, tipsForPage } from "@/lib/coach-core";
import { coachStore, useCoach } from "./coach-store";
import { CoachMark } from "./CoachMark";

export function CoachTips({ selfId, accountCreatedAtMs }: { selfId: string | null; accountCreatedAtMs: number | null }) {
  const path = usePathname() ?? "/";
  const { state } = useCoach();

  useEffect(() => {
    coachStore.init(accountCreatedAtMs);
  }, [accountCreatedAtMs]);

  const tips = tipsForPage(COACH_TIPS, { path, selfId, state });
  return (
    <>
      {tips.map((t) => (
        <CoachMark
          key={`${path}:${t.id}`}
          id={t.id}
          anchor={`[data-tip="${t.anchor}"]`}
          audience={t.audience}
          label={t.label}
          title={t.title}
          placement={t.placement}
          order={COACH_TIPS.indexOf(t)}
        >
          {t.body.map((line, i) => (
            <span key={i} className="coach-l">
              {line}
            </span>
          ))}
        </CoachMark>
      ))}
    </>
  );
}
