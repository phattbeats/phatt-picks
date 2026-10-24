/**
 * Hotline achievements (PHA-4477): the trinket pins and the achievement wall.
 *
 * Every achievement drops a trinket (PHA-4103); on Hotline it's an enamel pin —
 * gilt rim, dark enamel in the achievement's colour, the trinket struck in gold.
 * Unlocked pins line the profile hero; the wall lists all twelve, earned ones
 * dated, locked ones dim with how to earn them. Server components, pure SVG +
 * CSS (sg-people.css .ach-*), no images to load.
 */

import { ACHIEVEMENTS, type AchievementDef, type AchievementKey, type Unlock } from "@/lib/progression-core";

/** Trinket glyphs on a 24-unit grid, stroked in gilt. */
const GLYPHS: Record<AchievementKey, React.ReactNode> = {
  first_call: <path d="M7 4h3l1.4 3.6-1.9 1.3a10 10 0 0 0 5.6 5.6l1.3-1.9L20 14v3a2 2 0 0 1-2 2A15 15 0 0 1 5 6a2 2 0 0 1 2-2z" />,
  full_card: (
    <>
      <path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" />
      <path d="M14 7v10" strokeDasharray="1.6 1.8" />
    </>
  ),
  synced: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2" />
    </>
  ),
  stage_topper: (
    <>
      <path d="M8 20C4 17 3.5 11 6 7M16 20c4-3 4.5-9 2-13" />
      <path d="M5.2 15.5 3 14.6M4.6 12 2.6 10.6M5.4 8.8l-1.6-1.9M18.8 15.5l2.2-.9M19.4 12l2-1.4M18.6 8.8l1.6-1.9" />
      <path d="M12 9.2 13 11l2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L9 11.3l2-.3z" />
    </>
  ),
  clean_sweep: (
    <>
      <path d="M15.5 3 11 12.5" />
      <path d="M7.5 12.5h7.5l1.5 8h-11z" />
      <path d="M9 16v4.5M12 16v4.5M15 16v4.5" />
    </>
  ),
  called_it: (
    <>
      <path d="M4 8.5l4 4 4-7 4 7 4-4-1.8 10H5.8z" />
      <path d="M6 20h12" />
    </>
  ),
  climber: <path d="M12 20V5M6.5 10.5 12 5l5.5 5.5M7 20h10" />,
  bleachers: (
    <>
      <path d="M3.5 10v4h3.5l8 4.5V5.5L7 10z" />
      <path d="M18 9.2a4 4 0 0 1 0 5.6M20.3 7a7 7 0 0 1 0 10" />
    </>
  ),
  show_your_hand: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  poker_face: (
    <>
      <path d="M3.5 7.5c3-2.2 14-2.2 17 0 0 6.2-3.8 10-8.5 10s-8.5-3.8-8.5-10z" />
      <path d="M7 11.2h3.2M13.8 11.2H17M10 14.6h4" />
    </>
  ),
  veteran: (
    <>
      <path d="m8 5 1.3 2.8 3 .4-2.2 2.1.5 3L8 11.8l-2.6 1.5.5-3-2.2-2.1 3-.4z" />
      <path d="m16 10 1.3 2.8 3 .4-2.2 2.1.5 3-2.6-1.5-2.6 1.5.5-3-2.2-2.1 3-.4z" />
    </>
  ),
  perfect_swiss: (
    <>
      <path d="M7 4.5h10l3.5 5L12 20 3.5 9.5z" />
      <path d="M3.5 9.5h17M9.5 4.5 12 20l2.5-15.5" />
    </>
  ),
};

/** Enamel hue per pin — the site palette stretched to twelve. */
const ENAMEL: Record<AchievementKey, string> = {
  first_call: "#1f2a44",
  full_card: "#3a2a10",
  synced: "#13324a",
  stage_topper: "#123826",
  clean_sweep: "#2c1f3f",
  called_it: "#4a1410",
  climber: "#163a36",
  bleachers: "#45210c",
  show_your_hand: "#103040",
  poker_face: "#1a1a1e",
  veteran: "#2a2a12",
  perfect_swiss: "#10283f",
};

export function TrinketPin({
  def,
  earned,
  size = 44,
}: {
  def: AchievementDef;
  earned: boolean;
  size?: number;
}) {
  const id = `ach-g-${def.key}`;
  return (
    <span
      className={`ach-pin${earned ? "" : " locked"}`}
      style={{ width: size, height: size, ["--enamel" as string]: ENAMEL[def.key] } as React.CSSProperties}
    >
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff0b8" />
            <stop offset=".3" stopColor="#e3ad48" />
            <stop offset=".62" stopColor="#9c6a1c" />
            <stop offset="1" stopColor="#f4d27a" />
          </linearGradient>
        </defs>
        {earned ? (
          <>
            <circle cx="24" cy="24" r="22.5" fill={`url(#${id})`} />
            <circle cx="24" cy="24" r="19.5" fill="var(--enamel)" />
            <circle cx="24" cy="24" r="19.5" fill="none" stroke="rgba(0,0,0,.55)" strokeWidth="1" />
            <ellipse cx="18" cy="14" rx="10" ry="5" fill="rgba(255,255,255,.07)" transform="rotate(-28 18 14)" />
          </>
        ) : (
          <circle cx="24" cy="24" r="21.5" fill="none" stroke="var(--hair-3)" strokeWidth="1.2" strokeDasharray="2.4 2.6" />
        )}
        <g
          transform="translate(12 12)"
          fill="none"
          stroke={earned ? `url(#${id})` : "var(--dim)"}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {GLYPHS[def.key]}
        </g>
      </svg>
    </span>
  );
}

/** Earned pins along the profile hero, in registry order. */
export function PinRow({ unlocks }: { unlocks: readonly Unlock[] }) {
  if (unlocks.length === 0) return null;
  const earned = new Set(unlocks.map((u) => u.key));
  return (
    <ul className="ach-row" aria-label="Achievement pins">
      {ACHIEVEMENTS.filter((a) => earned.has(a.key)).map((a) => (
        <li key={a.key} title={`${a.name} · ${a.trinket}`}>
          <TrinketPin def={a} earned size={34} />
        </li>
      ))}
    </ul>
  );
}

function earnedLabel(atMs: number): string {
  return new Date(atMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The achievement wall: all twelve, earned first in registry order, then locked. */
export function AchievementWall({
  unlocks,
  isSelf,
  majorName,
}: {
  unlocks: readonly Unlock[];
  isSelf: boolean;
  /** Short Major name for an unlock's event id. */
  majorName: (eventId: number) => string | null;
}) {
  if (unlocks.length === 0 && !isSelf) return null;
  const byKey = new Map(unlocks.map((u) => [u.key, u] as const));
  const ordered = [...ACHIEVEMENTS].sort((a, b) => Number(byKey.has(b.key)) - Number(byKey.has(a.key)));
  return (
    <section className="chap ach-sect" id="achievements">
      <div className="chap-h row2">
        <div>
          <h2>Achievements</h2>
          <p>
            {isSelf
              ? "Each one drops a trinket pin and unlocks a banner photo for your profile, and all of it counts toward your PHATT ID."
              : "Each one drops a trinket pin."}
          </p>
        </div>
        <span className="eyebrow">
          {unlocks.length} of {ACHIEVEMENTS.length}
        </span>
      </div>
      <ul className="ach-wall">
        {ordered.map((a) => {
          const u = byKey.get(a.key);
          const where = u?.eventId != null ? majorName(u.eventId) : null;
          return (
            <li key={a.key} className={`ach-card${u ? " on" : ""}`}>
              <TrinketPin def={a} earned={!!u} />
              <div className="ach-txt">
                <span className="ach-nm">{a.name}</span>
                <span className="ach-desc">{a.description}</span>
                <span className="ach-meta">
                  {u ? (
                    <>
                      {a.trinket}
                      {where ? ` · ${where}` : ""} · {earnedLabel(u.atMs)}
                    </>
                  ) : (
                    "Locked"
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
