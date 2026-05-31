"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { Section, TeamDef } from "@/lib/layout";
import { bucketSwissSlots, isSwissSection } from "@/lib/swiss-bucket-core";
import { isPlayoffSection } from "@/lib/write-core";
import { LockInStage } from "@/components/LockInStage";

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
}

const SAVED_FLASH_MS = 1200;
const DND_MIME = "application/x-phatt-picks-team";

// Slots and pool tiles are the same size — drag-and-drop targets are visually
// identical to pool sources (PHA-877 iteration 3).
const SLOT_LOGO = 60;
const TILE_LOGO = 60;

export function PicksBoard({
  section,
  teams,
  initialPicks,
  enabled,
  eventId,
  steamLinked,
}: Props) {
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.pickid, t])), [teams]);

  const [picks, setPicks] = useState<PicksMap>(initialPicks);
  const [selected, setSelected] = useState<PickId | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [unsavedSinceSync, setUnsavedSinceSync] = useState(false);
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
  const selectedTeam = selected ? teamMap.get(selected) : null;

  return (
    <div className="pickboard">
      {section.groups.map((group) => {
        const ptsPerPick = group.points_per_pick;
        const groupPicksMap = picks[group.groupid] ?? {};
        const usedTeamIds = new Set(Object.values(groupPicksMap).filter((p) => p > 0));
        const filledCount = usedTeamIds.size;
        const slotTotal = group.picks.length;

        // Swiss stages → bucket the flat slots by predicted-outcome convention
        // (PHA-853). Non-Swiss (playoffs) → single "all slots" bucket so a QF
        // match's 1 slot still renders as one card with the group's match name.
        const buckets = isSwiss
          ? bucketSwissSlots(group.picks.length)
          : [{ label: group.name.split(" | ")[0], slotIndexes: group.picks.map((p) => p.index) }];

        const poolTeams = group.teams.filter((t) => t.pickid !== 0);

        return (
          <div key={group.groupid} className="pickgroup">
            <div className="pickgroup-head">
              <span className="pickgroup-name">{group.name.split(" | ")[0]}</span>
              <span className="pickgroup-pts">
                {ptsPerPick} PT{ptsPerPick !== 1 ? "S" : ""}/PICK · {filledCount}/{slotTotal}
              </span>
            </div>

            <div className="pickgroup-body">
              {/* Slots */}
              <div className={`bucket-cols${isSwiss ? " swiss" : ""}`}>
                {buckets.map((bucket) => (
                  <div key={bucket.label} className="bucket">
                    <div className="bucket-label">
                      <span>{bucket.label}</span>
                      <span className="count">
                        {bucket.slotIndexes.filter((i) => groupPicksMap[i]).length}/
                        {bucket.slotIndexes.length}
                      </span>
                    </div>

                    {bucket.slotIndexes.map((slotIndex) => {
                      const pickedId = groupPicksMap[slotIndex];
                      const team = pickedId ? teamMap.get(pickedId) : null;
                      const key = slotKey(group.groupid, slotIndex);
                      const save = saveStates[key];
                      const armed = enabled && selected !== null && !team;
                      const over = enabled && dragOverKey === key;

                      const cls = [
                        "pslot",
                        team ? "filled" : "",
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
                              <TeamLogo
                                tiers={resolveLogoTiers(team)}
                                teamName={team.name}
                                size={SLOT_LOGO}
                              />
                              <span className="pslot-name">{team.name}</span>
                            </>
                          ) : (
                            <span className="pslot-ph">
                              {armed ? "Tap to assign" : over ? "Drop to assign" : "Drag or tap a team"}
                            </span>
                          )}
                          {save && (
                            <span
                              className="pslot-state"
                              style={{
                                color:
                                  save === "error"
                                    ? "var(--ember)"
                                    : save === "saved"
                                      ? "var(--tac-green)"
                                      : "var(--ink-low)",
                              }}
                            >
                              {save === "saving" ? "Saving" : save === "saved" ? "Saved" : "Retry"}
                            </span>
                          )}
                          {team && enabled && (
                            <span
                              className="pslot-remove"
                              role="button"
                              aria-label={`Remove ${team.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                clearSlot(group.groupid, slotIndex);
                              }}
                            >
                              <svg viewBox="0 0 24 24">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Team pool — square tiles, big logos */}
              <div className="pool">
                <div className="pool-head">
                  <span className="pool-title">Team Pool · {poolTeams.length}</span>
                  <span className="pool-hint">Drag or tap to pick</span>
                </div>
                {enabled && selectedTeam && (
                  <div className="pool-armed-hint">{selectedTeam.name} — tap a slot to assign</div>
                )}
                <div className="pool-grid">
                  {poolTeams.map((teamSlot) => {
                    const t = teamMap.get(teamSlot.pickid);
                    if (!t) return null;
                    const isSelected = selected === t.pickid;
                    const isUsed = usedTeamIds.has(t.pickid);
                    const cls = ["ptile", isSelected ? "selected" : "", isUsed ? "used" : ""]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <button
                        key={teamSlot.pickid}
                        type="button"
                        className={cls}
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
                        <TeamLogo tiers={resolveLogoTiers(t)} teamName={t.name} size={TILE_LOGO} />
                        <span className="ptile-name">{t.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {enabled && steamLinked && (
        <LockInStage
          sectionId={isPlayoffSection(section.sectionid) ? "playoff" : section.sectionid}
          unsavedSinceSync={unsavedSinceSync}
          onSynced={() => setUnsavedSinceSync(false)}
        />
      )}
    </div>
  );
}
