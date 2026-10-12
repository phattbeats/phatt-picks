import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { LockIcon } from "@/components/ui/LockIcon";

export interface StageTab {
  key: string;
  href: string;
  label: string;
  /** Sub-line: "+8 scored", "3/10 · open", or a lock state. */
  sub: ReactNode;
  active: boolean;
  /** Picks are closed for this stage (padlock on the sub-line). */
  locked: boolean;
  /** Not seeded yet — the title dims. */
  upcoming: boolean;
  lockTitle?: string;
}

/**
 * Four equal stage tabs (I / II / III / Playoffs) with a sub-line each and a
 * 2px amber underline on the active one. Every tab is navigable — a locked
 * stage is "can't pick", not "can't look".
 */
export function StageTabs({ tabs }: { tabs: StageTab[] }) {
  return (
    <nav
      className="sgp-tabs rise d1"
      aria-label="Stages"
      style={{ "--n": tabs.length } as CSSProperties}
    >
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          prefetch={false}
          title={t.lockTitle}
          aria-current={t.active ? "page" : undefined}
          className={`sgp-tab${t.active ? " on" : ""}${t.upcoming ? " upcoming" : ""}`}
        >
          <span className="tl">{t.label}</span>
          <span className="ts">
            {t.locked && <LockIcon size={10} />}
            {t.sub}
          </span>
        </Link>
      ))}
    </nav>
  );
}
