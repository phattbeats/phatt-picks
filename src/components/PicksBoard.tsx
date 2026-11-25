"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { TeamStatsDrawer } from "@/components/ui/TeamStatsDrawer";
import { SpotlightModal, type SpotlightMarketLine } from "@/components/ui/SpotlightModal";
import { RegionBadge } from "@/components/ui/RegionBadge";
import { Flag } from "@/components/ui/Flag";
import { resolveLogoTiers } from "@/lib/logos";
import { teamAccent } from "@/lib/playoff-spotlights";
import type { Section, TeamDef } from "@/lib/layout";
import { statsForPickid, type TeamStats } from "@/lib/team-stats-core";
import { regionForPickid } from "@/lib/regions-core";
import { bucketSwissSlots, isSwissSection } from "@/lib/swiss-bucket-core";
import { isPlayoffSection } from "@/lib/write-core";
import { LockInStage } from "@/components/LockInStage";
import { ActionBar, type BarTone } from "@/components/sg/picks/ActionBar";
import { SealPicks, sealStatusText } from "@/components/sg/picks/SealPicks";
import type { SealView } from "@/lib/pick-lock-core";
import { bucketDisplay, playerCutout, teamCode, teamColor } from "@/components/sg/picks/team-art";
import { usePoolPhotos } from "@/components/sg/picks/PoolPhotos";
import { SaveError, usePickDraft, type SaveFn } from "@/components/usePickDraft";
import { flatten, slotKey, unflatten } from "@/lib/pick-draft-core";

type GroupId = number;
type SlotIndex = number;
type PickId = number;
type PicksMap = Record<GroupId, Record<SlotIndex, PickId>>;

interface Props {
  section: Section;
  teams: TeamDef[];
  initialPicks: PicksMap;
  enabled: boolean;
  eventId: number;
  /** Session player id — scopes the browser draft so a shared browser can't mix accounts. */
  playerId?: string | null;
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
  /** The viewer's self-seal on this stage (pick-lock-core) — sealed = read-only. */
  initialSeal?: SealView | null;
}

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
      loading="lazy"
      decoding="async"
      onError={() => setIndex((i) => i + 1)}
    />
  );
}

export function PicksBoard({
  section,
  teams,
  initialPicks,
  enabled: signedIn,
  eventId,
  playerId,
  steamLinked,
  initiallySynced,
  liveTeamStats,
  liveStatsAsOf,
  spotlightMarket,
  recordByTeam,
  initialSeal = null,
}: Props) {
  // A sealed stage is a commitment: the board turns read-only (the write path
  // refuses edits too — 409 picks_sealed).
  const [seal, setSeal] = useState<SealView | null>(initialSeal);
  const enabled = signedIn && !seal;
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.pickid, t])), [teams]);

  const [selected, setSelected] = useState<PickId | null>(null);
  // Player photos are off unless the viewer flips the switch at the page bottom;
  // the big team logo behind each card stays exactly as it was.
  const showPhotos = usePoolPhotos();
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  // Draft version last pushed to Steam; any later local change = "not on Steam".
  const [syncedVersion, setSyncedVersion] = useState(0);
  // Off-board team dossier (#893): roster/standing/recent matches. Closed by
  // default — opened by the [i] affordance on a pool tile, viewable regardless
  // of whether the stage is pickable or the team is already placed.
  const [statsTeam, setStatsTeam] = useState<TeamDef | null>(null);


  // Every call is written to this browser first, then pushed to HOTLINE
  // (PHA-5268). A failed push keeps the pick on the board and retries; it is
  // never thrown away unless the server refuses it for good (stage locked).
  const initialFlat = useMemo(() => flatten(initialPicks), [initialPicks]);
  const save = useCallback<SaveFn>(
    async (changed, desired) => {
      const batch = changed.map((k) => {
        const [groupId, slotIndex] = k.split(":").map(Number);
        return { groupId, slotIndex, pickId: desired[k] ?? 0, itemId: "" };
      });
      let res: Response;
      try {
        res = await fetch("/api/picks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, sectionId: section.sectionid, picks: batch }),
        });
      } catch {
        throw new SaveError(null);
      }
      if (!res.ok) throw new SaveError(res.status);
    },
    [eventId, section.sectionid],
  );
  const draft = usePickDraft({
    eventId,
    unit: section.sectionid,
    owner: playerId,
    initial: initialFlat,
    enabled,
    save,
  });
  const setFlat = draft.setPicks;
  const picks = useMemo<PicksMap>(() => unflatten(draft.picks), [draft.picks]);
  const pendingKeys = useMemo(() => new Set(draft.pending), [draft.pending]);
  const rejectedKeys = useMemo(() => new Set(draft.rejected), [draft.rejected]);


  // Drop a team into a slot — swaps if that team is already placed elsewhere
  // in the same group (Valve's behavior: every team appears at most once per
  // stage). Replaces silently if the target slot already had a different team.
  const dropTeamOnSlot = useCallback(
    (groupId: GroupId, slotIndex: SlotIndex, teamId: PickId) => {
      if (!enabled || teamId <= 0) return;
      setFlat((prev) => {
        const next = { ...prev };
        for (const [k, pid] of Object.entries(next)) {
          if (pid === teamId && k.startsWith(`${groupId}:`)) delete next[k];
        }
        next[slotKey(groupId, slotIndex)] = teamId;
        return next;
      });
    },
    [enabled, setFlat],
  );

  const clearSlot = useCallback(
    (groupId: GroupId, slotIndex: SlotIndex) => {
      if (!enabled) return;
      setFlat((prev) => {
        const next = { ...prev };
        delete next[slotKey(groupId, slotIndex)];
        return next;
      });
    },
    [enabled, setFlat],
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
  const localStatus: { text: string; tone: BarTone } | null =
    draft.status === "retrying"
      ? { text: "Couldn't reach HOTLINE — kept in this browser, retrying", tone: "warn" }
      : draft.status === "error"
        ? { text: "That change was refused — stage closed or sealed", tone: "err" }
        : draft.status === "saving" || draft.pending.length > 0
          ? { text: "Saving…", tone: "info" }
          : null;

  // HOTLINE self-seal (distinct from the amber Valve "Lock in & sync").
  const sealStatus: { text: string; tone: BarTone } | null = seal
    ? { text: sealStatusText(seal), tone: seal.steamDiverged ? "warn" : "ok" }
    : null;
  const sealControl = (
    <SealPicks
      sectionId={section.sectionid}
      stageLabel={section.name.split(" | ")[0]}
      total={slotTotal}
      ready={filledTotal >= slotTotal && !localStatus}
      seal={seal}
      onChange={(s) => {
        setSeal(s);
        setSelected(null);
      }}
      steamLinked={steamLinked}
    />
  );

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
                    <div className="sgp-bk" data-tip="picks-buckets">
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
                      const save = rejectedKeys.has(key)
                        ? "error"
                        : pendingKeys.has(key)
                          ? draft.status === "retrying"
                            ? "kept"
                            : "saving"
                          : null;
                      const armed = enabled && selected !== null && !team;
                      const over = enabled && dragOverKey === key;

                      const cls = [
                        "sgp-slot",
                        team ? "on" : "",
                        armed ? "armed" : "",
                        over ? "over" : "",
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
                                    ? `${disp.title} · tap a team, then here`
                                    : "Empty"}
                            </span>
                          )}
                          {save && (
                            <span
                              className={`st${save === "error" ? " err" : ""}`}
                              title={save === "kept" ? "Saved in this browser; sending to HOTLINE when it's reachable" : undefined}
                            >
                              {save === "saving" ? "Saving" : save === "kept" ? "Kept here" : "Refused"}
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
                  ) : signedIn ? (
                    "Sealed · read only"
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
                  const tStats = liveTeamStats?.[t.pickid] ?? statsForPickid(t.pickid);
                  const rank = tStats?.worldRank;
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
                        {cutout && showPhotos && (
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
                          <Flag country={tStats?.country} />
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
                        data-tip="picks-dossier"
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

      {signedIn &&
        (steamLinked ? (
          <LockInStage
            sectionId={isPlayoff ? "playoff" : section.sectionid}
            unsavedSinceSync={draft.version !== syncedVersion}
            initiallySynced={initiallySynced}
            onSynced={() => setSyncedVersion(draft.version)}
            progress={{ filled: filledTotal, total: slotTotal }}
            localStatus={localStatus ?? sealStatus}
            secondary={sealControl}
          />
        ) : (
          // Not Steam-linked: picks save in HOTLINE only, so no Lock In CTA —
          // sealing is the only action.
          <ActionBar
            filled={filledTotal}
            total={slotTotal}
            state={localStatus?.text ?? sealStatus?.text ?? (filledTotal >= slotTotal ? "All calls made" : "Saved · local")}
            tone={localStatus?.tone ?? sealStatus?.tone ?? "info"}
            cta={sealControl}
          />
        ))}

      {/* Playoffs (#1043): the eight survivors get a Spotlight — narrative +
          event highlight + live market line — instead of the clinical dossier.
          Swiss stages keep the lean dossier. */}
      {statsTeam &&
        (isPlayoff ? (
          <SpotlightModal
            eventId={eventId}
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
