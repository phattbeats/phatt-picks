"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { Section, TeamDef } from "@/lib/layout";

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
}

const SAVED_FLASH_MS = 1200;

export function PicksBoard({ section, teams, initialPicks, enabled, eventId }: Props) {
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.pickid, t])), [teams]);

  const [picks, setPicks] = useState<PicksMap>(initialPicks);
  const [selected, setSelected] = useState<PickId | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const lastSavedRef = useRef<PicksMap>(initialPicks);

  const slotKey = (groupId: GroupId, slotIndex: SlotIndex) => `${groupId}:${slotIndex}`;

  const persist = useCallback(
    async (groupId: GroupId, slotIndex: SlotIndex, pickId: PickId) => {
      const key = slotKey(groupId, slotIndex);
      setSaveStates((s) => ({ ...s, [key]: "saving" }));
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
        // Revert to last server-acknowledged value.
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

  const handleSlotTap = (groupId: GroupId, slotIndex: SlotIndex) => {
    if (!enabled) return;
    const current = picks[groupId]?.[slotIndex];

    if (selected !== null) {
      // Assign or replace — even if the slot already holds something.
      if (current === selected) {
        setSelected(null);
        return;
      }
      setPicks((prev) => ({
        ...prev,
        [groupId]: { ...(prev[groupId] ?? {}), [slotIndex]: selected },
      }));
      const teamId = selected;
      setSelected(null);
      void persist(groupId, slotIndex, teamId);
      return;
    }

    // No team armed — tapping a filled slot clears it.
    if (current) {
      setPicks((prev) => {
        const groupCopy = { ...(prev[groupId] ?? {}) };
        delete groupCopy[slotIndex];
        return { ...prev, [groupId]: groupCopy };
      });
      void persist(groupId, slotIndex, 0);
    }
  };

  const handleTeamTap = (pickId: PickId) => {
    if (!enabled) return;
    setSelected((cur) => (cur === pickId ? null : pickId));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {section.groups.map((group) => {
        const ptsPerPick = group.points_per_pick;
        const groupPicksMap = picks[group.groupid] ?? {};
        const usedTeamIds = new Set(Object.values(groupPicksMap).filter((p) => p > 0));

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

            <div style={{ padding: "var(--space-3)" }}>
              {group.picks.map((slot) => {
                const pickedId = groupPicksMap[slot.index];
                const team = pickedId ? teamMap.get(pickedId) : null;
                const key = slotKey(group.groupid, slot.index);
                const save = saveStates[key];
                const interactive = enabled && (selected !== null || !!team);
                const armed = enabled && selected !== null;
                const borderColor =
                  save === "error"
                    ? "var(--accent)"
                    : save === "saved"
                      ? "var(--correct, var(--accent))"
                      : armed
                        ? "var(--accent)"
                        : "var(--bg3)";

                return (
                  <button
                    key={slot.index}
                    type="button"
                    onClick={() => handleSlotTap(group.groupid, slot.index)}
                    disabled={!interactive}
                    aria-label={
                      team
                        ? `Pick slot ${slot.index + 1}: ${team.name}. Tap to ${armed ? "replace" : "clear"}.`
                        : `Pick slot ${slot.index + 1}: empty. ${armed ? "Tap to assign selected team." : "Pick a team first."}`
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-3)",
                      padding: "var(--space-2) var(--space-3)",
                      borderRadius: "var(--radius-md)",
                      background: team ? "var(--bg2)" : armed ? "rgba(255,255,255,0.02)" : "transparent",
                      border: `${team ? "1px solid" : armed ? "1px solid" : "1px dashed"} ${borderColor}`,
                      marginBottom: "var(--space-2)",
                      minHeight: 44,
                      width: "100%",
                      textAlign: "left",
                      cursor: interactive ? "pointer" : "default",
                      color: "inherit",
                      font: "inherit",
                      transition: "border-color var(--duration-fast) var(--ease-sharp)",
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        fontFamily: "'Rajdhani', sans-serif",
                        fontWeight: 700,
                        fontSize: "0.75rem",
                        color: "var(--text-low)",
                        textAlign: "center",
                      }}
                    >
                      {slot.index + 1}
                    </span>
                    {team ? (
                      <>
                        <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={28} />
                        <span style={{ color: "var(--text-hi)", fontSize: "0.875rem", fontWeight: 500, flex: 1 }}>
                          {team.name}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: "var(--text-low)", fontSize: "0.875rem", flex: 1 }}>
                        {armed ? "Tap to assign" : "— Pick a team"}
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
                    Pick a slot above
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
                          cursor: enabled ? "pointer" : "default",
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
    </div>
  );
}
