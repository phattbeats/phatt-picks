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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {section.groups.map((group) => {
        const ptsPerPick = group.points_per_pick;
        const groupPicksMap = picks[group.groupid] ?? {};
        const usedTeamIds = new Set(Object.values(groupPicksMap).filter((p) => p > 0));

        // Swiss stages → bucket the flat slots by predicted-outcome convention
        // (PHA-853). Non-Swiss (playoffs) → single "all slots" bucket so a QF
        // match's 1 slot still renders as one card with the group's match name.
        const buckets = isSwiss
          ? bucketSwissSlots(group.picks.length)
          : [{ label: group.name.split(" | ")[0], slotIndexes: group.picks.map((p) => p.index) }];

        return (
          <div
            key={group.groupid}
            style={{
              background: "var(--bg1)",
              border: "1px solid var(--bg3)",
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "var(--space-3) var(--space-4)",
                borderBottom: "1px solid var(--bg3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontFamily: "'Rajdhani', sans-serif",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "var(--text-mid)",
                }}
              >
                {group.name.split(" | ")[0]}
              </span>
              <span
                style={{
                  fontFamily: "'Rajdhani', sans-serif",
                  fontWeight: 700,
                  fontSize: "0.75rem",
                  color: "var(--accent)",
                  letterSpacing: "0.05em",
                }}
              >
                {ptsPerPick} PT{ptsPerPick !== 1 ? "S" : ""}/PICK
              </span>
            </div>

            <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {buckets.map((bucket) => (
                <div
                  key={bucket.label}
                  style={{
                    background: "var(--bg0, transparent)",
                    border: "1px solid var(--bg3)",
                    borderRadius: "var(--radius-md)",
                    padding: "var(--space-2) var(--space-3)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "var(--space-2)",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Rajdhani', sans-serif",
                        fontWeight: 700,
                        fontSize: "0.75rem",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--text-hi)",
                      }}
                    >
                      {bucket.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "'Rajdhani', sans-serif",
                        fontSize: "0.6875rem",
                        color: "var(--text-low)",
                      }}
                    >
                      {bucket.slotIndexes.length} pick
                      {bucket.slotIndexes.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {bucket.slotIndexes.map((slotIndex) => {
                      const pickedId = groupPicksMap[slotIndex];
                      const team = pickedId ? teamMap.get(pickedId) : null;
                      const key = slotKey(group.groupid, slotIndex);
                      const save = saveStates[key];
                      const armed = enabled && selected !== null;
                      const hovered = enabled && dragOverKey === key;
                      const interactive = enabled;
                      const borderColor =
                        save === "error"
                          ? "var(--accent)"
                          : save === "saved"
                            ? "var(--correct, var(--accent))"
                            : hovered || armed
                              ? "var(--accent)"
                              : "var(--bg3)";

                      return (
                        <button
                          key={slotIndex}
                          type="button"
                          onClick={() => handleSlotTap(group.groupid, slotIndex)}
                          disabled={!interactive}
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
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-3)",
                            padding: "var(--space-2) var(--space-3)",
                            borderRadius: "var(--radius-md)",
                            background: team
                              ? "var(--bg2)"
                              : hovered || armed
                                ? "rgba(255,255,255,0.04)"
                                : "transparent",
                            border: `${team || hovered || armed ? "1px solid" : "1px dashed"} ${borderColor}`,
                            minHeight: 44,
                            width: "100%",
                            textAlign: "left",
                            cursor: interactive ? (team ? "grab" : "pointer") : "default",
                            color: "inherit",
                            font: "inherit",
                            transition: "border-color var(--duration-fast) var(--ease-sharp), background var(--duration-fast) var(--ease-sharp)",
                          }}
                        >
                          {team ? (
                            <>
                              <TeamLogo
                                tiers={resolveLogoTiers(team)}
                                teamName={team.name}
                                size={28}
                              />
                              <span
                                style={{
                                  color: "var(--text-hi)",
                                  fontSize: "0.875rem",
                                  fontWeight: 500,
                                  flex: 1,
                                }}
                              >
                                {team.name}
                              </span>
                            </>
                          ) : (
                            <span
                              style={{
                                color: "var(--text-low)",
                                fontSize: "0.875rem",
                                flex: 1,
                              }}
                            >
                              {armed
                                ? "Tap to assign"
                                : hovered
                                  ? "Drop to assign"
                                  : "— Drag or tap a team"}
                            </span>
                          )}
                          {save && (
                            <span
                              style={{
                                fontFamily: "'Rajdhani', sans-serif",
                                fontSize: "0.6875rem",
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color:
                                  save === "error"
                                    ? "var(--accent)"
                                    : save === "saved"
                                      ? "var(--correct, var(--accent))"
                                      : "var(--text-low)",
                              }}
                            >
                              {save === "saving" ? "Saving" : save === "saved" ? "Saved" : "Retry"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                padding: "var(--space-3) var(--space-4)",
                borderTop: "1px solid var(--bg3)",
              }}
            >
              <p
                style={{
                  fontFamily: "'Rajdhani', sans-serif",
                  fontSize: "0.625rem",
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--text-low)",
                  margin: "0 0 var(--space-2)",
                }}
              >
                Teams ({group.teams.filter((t) => t.pickid !== 0).length})
                {enabled && selected !== null && (
                  <span style={{ marginLeft: "var(--space-2)", color: "var(--accent)" }}>
                    Tap a slot or drag
                  </span>
                )}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                {group.teams
                  .filter((t) => t.pickid !== 0)
                  .map((teamSlot) => {
                    const t = teamMap.get(teamSlot.pickid);
                    if (!t) return null;
                    const isSelected = selected === t.pickid;
                    const isUsed = usedTeamIds.has(t.pickid);

                    return (
                      <button
                        key={teamSlot.pickid}
                        type="button"
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
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-2)",
                          padding: "var(--space-2) var(--space-3)",
                          background: isSelected ? "var(--accent)" : "var(--bg3)",
                          border: isSelected ? "1px solid var(--accent)" : "1px solid transparent",
                          borderRadius: "var(--radius-sm)",
                          fontSize: "0.75rem",
                          color: isSelected ? "#fff" : "var(--text-hi)",
                          cursor: enabled ? "grab" : "default",
                          opacity: !enabled ? 0.6 : isUsed && !isSelected ? 0.5 : 1,
                          minHeight: 44,
                          font: "inherit",
                          transition:
                            "background var(--duration-fast) var(--ease-sharp), border-color var(--duration-fast) var(--ease-sharp)",
                        }}
                      >
                        <TeamLogo tiers={resolveLogoTiers(t)} teamName={t.name} size={24} />
                        {t.name}
                      </button>
                    );
                  })}
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
