"use client";

import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { TeamStatsDrawer } from "@/components/ui/TeamStatsDrawer";
import { SpotlightModal, type SpotlightMarketLine } from "@/components/ui/SpotlightModal";
import { RegionBadge } from "@/components/ui/RegionBadge";
import { resolveLogoTiers } from "@/lib/logos";
import { teamAccent } from "@/lib/playoff-spotlights";
import type { Section, TeamDef } from "@/lib/layout";
import { statsForPickid, type TeamStats } from "@/lib/team-stats-core";
import { regionForPickid } from "@/lib/regions-core";
import { bucketSwissSlots, isSwissSection } from "@/lib/swiss-bucket-core";
import { isPlayoffSection } from "@/lib/write-core";
import { LockInStage } from "@/components/LockInStage";
import { ActionBar, type BarTone } from "@/components/sg/picks/ActionBar";
import { bucketDisplay, playerCutout, teamCode, teamColor } from "@/components/sg/picks/team-art";

type GroupId = number;
type SlotIndex = number;
type PickId = number;
type PicksMap = Record<GroupId, Record<SlotIndex, PickId>>;
type SaveState = "saving" | "saved" | "error";

interface Props {
  section: Section;
  teams: TeamDef[];
  initialPicks: PicksMap;
  enabled: boolean;
  eventId: number;
  steamLinked: boolean;
  /** Server-derived: every stored pick for this stage is already on Steam (#1214). */
  initiallySynced?: boolean;
  /**
   * Live per-stage dossier map (#921), pickid → stats with `recent[]` pulled
   * live. Optional: undefined off-window / cold start, in which case the drawer
   * falls back to the committed frozen snapshot.
   */
  liveTeamStats?: Record<number, TeamStats>;
  /** Snapshot date of the live dossier crawl (YYYY-MM-DD), for the drawer footer. */
  liveStatsAsOf?: string;
  /**
   * Live playoff market lines (#1066), pickid → Polymarket implied win %.
   * Optional: empty/undefined until a matchup is authored + seeded, in which case
   * the Spotlight modal shows its "coming soon" odds state.
   */
  spotlightMarket?: Record<number, SpotlightMarketLine>;
  /**
   * Live partial Swiss W-L per team (pickid → record), present once the stage's
   * bracket is revealed. Shown on pool cards and in the dossier; display only.
   */
  recordByTeam?: Record<number, { wins: number; losses: number }>;
}

const SAVED_FLASH_MS = 1200;
const DND_MIME = "application/x-phatt-picks-team";

// Singapore board (HANDOFF §3): slots are 54px rows with a 34px team mark;
// pool cards carry a small logo tile over the cutout / team colour.
const SLOT_LOGO = 26;
const TILE_LOGO = 20;

const fmtRecord = (r?: { wins: number; losses: number }) => (r ? `${r.wins}–${r.losses}` : null);

/**
 * Pool-card background art: the team's logo, oversized and cropped by the card
 * (the self-hosted mark first, then the sticker). Walks the same tiers as
 * TeamLogo and falls back to the team code only when no image loads. Plain
 * opacity, no filter, so a full pool stays cheap to composite (#1269).
 */
function PoolLogoArt({ team }: { team: TeamDef }) {
  const srcs = useMemo(
    () => resolveLogoTiers(team).flatMap((tier) => (tier.kind === "image" ? [tier.src] : [])),
    [team],
  );
  const [index, setIndex] = useState(0);
  if (index >= srcs.length) return <span className="code">{teamCode(team)}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote sticker fallback; TeamLogo is unoptimized too.
    <img
      className="logo"
      src={srcs[index]}
      alt=""
      draggable={false}
      decoding="async"
      onError={() => setIndex((i) => i + 1)}
    />
  );
}

export function PicksBoard({
  section,
  teams,
  initialPicks,
  enabled,
  eventId,
  steamLinked,
  initiallySynced,
  liveTeamStats,
  liveStatsAsOf,
  spotlightMarket,
  recordByTeam,
}: Props) {
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.pickid, t])), [teams]);

  const [picks, setPicks] = useState<PicksMap>(initialPicks);
  const [selected, setSelected] = useState<PickId | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [unsavedSinceSync, setUnsavedSinceSync] = useState(false);
  // Off-board team dossier (#893): roster/standing/recent matches. Closed by
  // default — opened by the [i] affordance on a pool tile, viewable regardless
  // of whether the stage is pickable or the team is already placed.
  const [statsTeam, setStatsTeam] = useState<TeamDef | null>(null);
  const lastSavedRef = useRef<PicksMap>(initialPicks);

  const slotKey = (groupId: GroupId, slotIndex: SlotIndex) => `${groupId}:${slotIndex}`;

  const persist = useCallback(
    async (groupId: GroupId, slotIndex: SlotIndex, pickId: PickId) => {
      const key = slotKey(groupId, slotIndex);
      setSaveStates((s) => ({ ...s, [key]: "saving" }));
      setUnsavedSinceSync(true);
      try {
        const res = await fetch("/api/picks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId,
            sectionId: section.sectionid,
            picks: [{ groupId, slotIndex, pickId, itemId: "" }],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        lastSavedRef.current = {
          ...lastSavedRef.current,
          [groupId]: { ...(lastSavedRef.current[groupId] ?? {}), [slotIndex]: pickId },
        };
        setSaveStates((s) => ({ ...s, [key]: "saved" }));
        window.setTimeout(() => {
          setSaveStates((s) => {
            if (s[key] !== "saved") return s;
            const next = { ...s };
            delete next[key];
            return next;
          });
        }, SAVED_FLASH_MS);
      } catch {
        setPicks((prev) => {
          const lastForGroup = lastSavedRef.current[groupId] ?? {};
          const revertedSlot = lastForGroup[slotIndex];
          const groupCopy = { ...(prev[groupId] ?? {}) };
          if (revertedSlot === undefined || revertedSlot === 0) {
            delete groupCopy[slotIndex];
          } else {
            groupCopy[slotIndex] = revertedSlot;
          }
          return { ...prev, [groupId]: groupCopy };
        });
        setSaveStates((s) => ({ ...s, [key]: "error" }));
      }
    },
    [eventId, section.sectionid],
  );

  // Drop a team into a slot — swaps if that team is already placed elsewhere
  // in the same group (Valve's behavior: every team appears at most once per
  // stage). Replaces silently if the target slot already had a different team.
  const dropTeamOnSlot = useCallback(
    (groupId: GroupId, slotIndex: SlotIndex, teamId: PickId) => {
      if (!enabled || teamId <= 0) return;
      let previousSlotIndex: number | null = null;
      setPicks((prev) => {
        const groupCopy = { ...(prev[groupId] ?? {}) };
        for (const [si, pid] of Object.entries(groupCopy)) {
          if (pid === teamId && Number(si) !== slotIndex) {
            previousSlotIndex = Number(si);
            delete groupCopy[Number(si)];
          }
        }
        groupCopy[slotIndex] = teamId;
        return { ...prev, [groupId]: groupCopy };
      });
      void persist(groupId, slotIndex, teamId);
      if (previousSlotIndex !== null) {
        void persist(groupId, previousSlotIndex, 0);
      }
    },
    [enabled, persist],
  );

  const clearSlot = useCallback(
    (groupId: GroupId, slotIndex: SlotIndex) => {
      if (!enabled) return;
      setPicks((prev) => {
        const groupCopy = { ...(prev[groupId] ?? {}) };
        delete groupCopy[slotIndex];
        return { ...prev, [groupId]: groupCopy };
      });
      void persist(groupId, slotIndex, 0);
    },
    [enabled, persist],
  );

  const handleSlotTap = (groupId: GroupId, slotIndex: SlotIndex) => {
    if (!enabled) return;
    const current = picks[groupId]?.[slotIndex];

    if (selected !== null) {
      if (current === selected) {
        setSelected(null);
        return;
      }
      const teamId = selected;
      setSelected(null);
      dropTeamOnSlot(groupId, slotIndex, teamId);
      return;
    }

    if (current) {
      clearSlot(groupId, slotIndex);
    }
  };

  const handleTeamTap = (pickId: PickId) => {
    if (!enabled) return;
    setSelected((cur) => (cur === pickId ? null : pickId));
  };

  const isSwiss = isSwissSection(section.sectionid);
  const isPlayoff = isPlayoffSection(section.sectionid);
  const selectedTeam = selected ? teamMap.get(selected) : null;

  // Board-wide progress for the action bar (every group's slots).
  const slotTotal = section.groups.reduce((n, g) => n + g.picks.length, 0);
  const filledTotal = section.groups.reduce(
    (n, g) => n + new Set(Object.values(picks[g.groupid] ?? {}).filter((p) => p > 0)).size,
    0,
  );
  const saveValues = Object.values(saveStates);
  const localStatus: { text: string; tone: BarTone } | null = saveValues.includes("error")
    ? { text: "Save failed — tap the slot to retry", tone: "err" }
    : saveValues.includes("saving")
      ? { text: "Saving…", tone: "info" }
      : null;

  return (
    <div className="pickboard-sg">
      {section.groups.map((group) => {
        const groupPicksMap = picks[group.groupid] ?? {};
        const usedTeamIds = new Set(Object.values(groupPicksMap).filter((p) => p > 0));

        // Swiss stages → bucket the flat slots by predicted-outcome convention
        // (#853). Non-Swiss (playoffs) → single "all slots" bucket so a QF
        // match's 1 slot still renders as one card with the group's match name.
        const buckets = isSwiss
          ? bucketSwissSlots(group.picks.length)
          : [{ label: group.name.split(" | ")[0], slotIndexes: group.picks.map((p) => p.index) }];

        // Which bucket each placed team sits in — the pool card shows it.
        const bucketOfTeam = new Map<number, string>();
        for (const b of buckets) {
          for (const i of b.slotIndexes) {
            const pid = groupPicksMap[i];
            if (pid) bucketOfTeam.set(pid, bucketDisplay(b.label).short);
          }
        }

        const poolTeams = group.teams.filter((t) => t.pickid !== 0);

        return (
          <div key={group.groupid} className="sgp-board">
            {/* Buckets — sticky on desktop, above the pool on mobile */}
            <aside className="sgp-slots" aria-label="Your calls">
              {section.groups.length > 1 && (
                <div className="sgp-group-name">
                  <span>{group.name.split(" | ")[0]}</span>
                  <b>
                    {group.points_per_pick} pt{group.points_per_pick !== 1 ? "s" : ""} per call
                  </b>
                </div>
              )}
              {buckets.map((bucket) => {
                const disp = bucketDisplay(bucket.label);
                return (
                  <div key={bucket.label} className="sgp-bucket">
                    <div className="sgp-bk">
                      <span>{disp.title}</span>
                      <b>
                        {bucket.slotIndexes.filter((i) => groupPicksMap[i]).length}/
                        {bucket.slotIndexes.length}
                      </b>
                    </div>

                    {bucket.slotIndexes.map((slotIndex) => {
                      const pickedId = groupPicksMap[slotIndex];
                      const team = pickedId ? teamMap.get(pickedId) : null;
                      const key = slotKey(group.groupid, slotIndex);
                      const save = saveStates[key];
                      const armed = enabled && selected !== null && !team;
                      const over = enabled && dragOverKey === key;

                      const cls = [
                        "sgp-slot",
                        team ? "on" : "",
                        armed ? "armed" : "",
                        over ? "over" : "",
                        save === "saved" ? "saved" : "",
                        save === "error" ? "error" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <button
                          key={slotIndex}
                          type="button"
                          className={cls}
                          onClick={() => handleSlotTap(group.groupid, slotIndex)}
                          disabled={!enabled}
                          draggable={!!team && enabled}
                          onDragStart={(e) => {
                            if (!team) return;
                            e.dataTransfer.setData(DND_MIME, String(team.pickid));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            if (!enabled) return;
                            const types = e.dataTransfer.types;
                            if (types.includes(DND_MIME) || types.includes("Text")) {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              if (dragOverKey !== key) setDragOverKey(key);
                            }
                          }}
                          onDragLeave={() => {
                            if (dragOverKey === key) setDragOverKey(null);
                          }}
                          onDrop={(e) => {
                            if (!enabled) return;
                            const raw =
                              e.dataTransfer.getData(DND_MIME) ||
                              e.dataTransfer.getData("text/plain");
                            const teamId = Number(raw);
                            if (!Number.isFinite(teamId) || teamId <= 0) return;
                            e.preventDefault();
                            setDragOverKey(null);
                            dropTeamOnSlot(group.groupid, slotIndex, teamId);
                          }}
                          aria-label={
                            team
                              ? `${bucket.label} slot: ${team.name}. Tap to ${armed ? "replace" : "clear"}, or drag to move.`
                              : `${bucket.label} slot: empty. ${armed ? "Tap to assign selected team." : "Drag a team here or tap a team first."}`
                          }
                        >
                          {team ? (
                            <>
                              <span className="sgp-mark" aria-hidden="true">
                                <TeamLogo
                                  tiers={resolveLogoTiers(team)}
                                  teamName={team.name}
                                  size={SLOT_LOGO}
                                />
                              </span>
                              <span className="nm">{team.name}</span>
                              <RegionBadge pickid={team.pickid} />
                            </>
                          ) : (
                            <span className="ph">
                              {armed && selectedTeam
                                ? `Tap to place ${selectedTeam.name}`
                                : over
                                  ? "Drop to place"
                                  : enabled
                                    ? "Tap a team, then here"
                                    : "Empty"}
                            </span>
                          )}
                          {save && (
                            <span
                              className={`st${save === "error" ? " err" : save === "saved" ? " ok" : ""}`}
                            >
                              {save === "saving" ? "Saving" : save === "saved" ? "Saved" : "Retry"}
                            </span>
                          )}
                          {team && enabled && (
                            <span
                              className="x"
                              role="button"
                              aria-label={`Remove ${team.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                clearSlot(group.groupid, slotIndex);
                              }}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </aside>

            {/* Team pool — player cutout or team colour, rank / region / record */}
            <section className="sgp-pool" aria-label="Team pool">
              <div className="sgp-poolhead">
                <span>Team pool · {poolTeams.length}</span>
                <span className="muted">
                  {enabled ? (
                    <>
                      Tap or drag · <i>{isPlayoff ? "★" : "i"}</i> for {isPlayoff ? "spotlight" : "dossier"}
                    </>
                  ) : (
                    "Sign in to make your calls"
                  )}
                </span>
              </div>
              {enabled && selectedTeam && (
                <div className="sgp-armed" aria-live="polite">
                  {selectedTeam.name} — tap a slot to place
                </div>
              )}
              <div className="sgp-pool-grid">
                {poolTeams.map((teamSlot) => {
                  const t = teamMap.get(teamSlot.pickid);
                  if (!t) return null;
                  const isSelected = selected === t.pickid;
                  const isUsed = usedTeamIds.has(t.pickid);
                  const color = teamColor(t);
                  const cutout = playerCutout(t.pickid);
                  const cls = ["sgp-team", cutout ? "cut" : "", isSelected ? "sel" : "", isUsed ? "used" : ""]
                    .filter(Boolean)
                    .join(" ");
                  const rank = (liveTeamStats?.[t.pickid] ?? statsForPickid(t.pickid))?.worldRank;
                  const region = regionForPickid(t.pickid);
                  const rec = fmtRecord(recordByTeam?.[t.pickid]);
                  const meta = [rank != null ? `#${rank}` : null, region].filter(Boolean).join(" · ");

                  return (
                    <div key={teamSlot.pickid} className="sgp-card">
                      <button
                        type="button"
                        className={cls}
                        style={color ? ({ "--team": color } as CSSProperties) : undefined}
                        onClick={() => handleTeamTap(t.pickid)}
                        disabled={!enabled}
                        draggable={enabled}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DND_MIME, String(t.pickid));
                          e.dataTransfer.setData("text/plain", String(t.pickid));
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        aria-pressed={isSelected}
                        aria-label={`${t.name}${isUsed ? " (already picked)" : ""}${isSelected ? " — selected" : ""}`}
                      >
                        {/* Team logo large behind everything (the code only
                            when no logo loads), then the player cutout over it. */}
                        <span className="bg" aria-hidden="true">
                          <PoolLogoArt team={t} />
                        </span>
                        {cutout && (
                          <Image
                            src={cutout}
                            alt=""
                            fill
                            sizes="(min-width: 1024px) 200px, 50vw"
                            draggable={false}
                          />
                        )}
                        <span className="sgp-mark sm" aria-hidden="true">
                          <TeamLogo tiers={resolveLogoTiers(t)} teamName={t.name} size={TILE_LOGO} />
                        </span>
                        {isUsed && bucketOfTeam.has(t.pickid) && (
                          <span className="in" aria-hidden="true">
                            {bucketOfTeam.get(t.pickid)}
                          </span>
                        )}
                        <span className="nm">{t.name}</span>
                        <span className="meta">
                          {rec && (
                            <>
                              <b>{rec}</b>
                              {meta ? " · " : ""}
                            </>
                          )}
                          {meta}
                        </span>
                      </button>
                      {/* Sibling, not a child — stays clickable when the card
                          is `used` (pointer-events:none) or the stage is locked. */}
                      <span
                        className={`sgp-info${isPlayoff ? " spot" : ""}`}
                        style={
                          isPlayoff && teamAccent(t)
                            ? ({ "--team-accent": teamAccent(t) } as CSSProperties)
                            : undefined
                        }
                        role="button"
                        tabIndex={0}
                        aria-label={isPlayoff ? `${t.name} spotlight` : `${t.name} stats and standings`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setStatsTeam(t);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setStatsTeam(t);
                          }
                        }}
                      >
                        {isPlayoff ? "★" : "i"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        );
      })}

      {enabled &&
        (steamLinked ? (
          <LockInStage
            sectionId={isPlayoff ? "playoff" : section.sectionid}
            unsavedSinceSync={unsavedSinceSync}
            initiallySynced={initiallySynced}
            onSynced={() => setUnsavedSinceSync(false)}
            progress={{ filled: filledTotal, total: slotTotal }}
            localStatus={localStatus}
          />
        ) : (
          // Not Steam-linked: picks save in HOTLINE only, so no Lock In CTA.
          <ActionBar
            filled={filledTotal}
            total={slotTotal}
            state={localStatus?.text ?? (filledTotal >= slotTotal ? "All calls made" : "Saved · local")}
            tone={localStatus?.tone ?? "info"}
          />
        ))}

      {/* Playoffs (#1043): the eight survivors get a Spotlight — narrative +
          event highlight + live market line — instead of the clinical dossier.
          Swiss stages keep the lean dossier. */}
      {statsTeam &&
        (isPlayoff ? (
          <SpotlightModal
            team={statsTeam}
            onClose={() => setStatsTeam(null)}
            liveStats={liveTeamStats?.[statsTeam.pickid]}
            liveAsOf={liveStatsAsOf}
            market={spotlightMarket?.[statsTeam.pickid]}
          />
        ) : (
          <TeamStatsDrawer
            team={statsTeam}
            onClose={() => setStatsTeam(null)}
            liveStats={liveTeamStats?.[statsTeam.pickid]}
            liveAsOf={liveStatsAsOf}
            record={recordByTeam?.[statsTeam.pickid]}
          />
        ))}
    </div>
  );
}
