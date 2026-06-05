/**
 * Locked picks board (PHA-902) — the picker UI, frozen, with your calls.
 *
 * Brandon: once a Swiss stage locks, drop the "YOUR BUILD / THE FIELD" lineup and
 * instead keep the SAME UI where you made your picks — the 3:0 / advance / 0:3
 * bucket slots — with the teams you locked in, then turn each one green when it's
 * confirmed right and red when it's confirmed wrong.
 *
 * Read-only mirror of <PicksBoard>: it reuses the exact picker CSS (.pickboard /
 * .bucket-cols.swiss / .pslot.filled) so it looks identical to where you picked,
 * minus the team pool and any interaction. Each filled slot is colored by
 * confirmPick() against the live answer key (StageOutcome): green = the team
 * landed in the bucket you called, red = it clinched a different one, neutral =
 * still in play. Logos are large. Honest: nothing turns green/red until the
 * answer key actually confirms it.
 */

import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { Section, TeamDef } from "@/lib/layout";
import { bucketSwissSlots } from "@/lib/swiss-bucket-core";
import { confirmPick, isPredictedBucketFull, type SwissTeamStatus, type PickConfirm } from "@/lib/swiss-standings-core";
import { LastUpdated } from "@/components/LastUpdated";

const LOGO = 56;

const CONFIRM_META: Record<PickConfirm, { cls: string; mark: string; color: string; title: string }> = {
  right: { cls: "pick-right", mark: "✓", color: "var(--tac-green, #9bd23c)", title: "Called it" },
  wrong: { cls: "pick-wrong", mark: "✗", color: "var(--ember, #d8351c)", title: "Landed elsewhere" },
  pending: { cls: "", mark: "", color: "var(--ink-low)", title: "Still in play" },
};

export function LockedPicksBoard({
  section,
  teamMap,
  myPicks,
  teamStatus,
  resolvedAtIso,
  title = "[ YOUR LOCKED PICKS ]",
}: {
  section: Section;
  teamMap: Map<number, TeamDef>;
  /** groupId -> slotIndex -> pickId (the viewer's locked picks). */
  myPicks: Record<number, Record<number, number>>;
  /** pickId -> answer-key status, from the live standings. */
  teamStatus: Map<number, SwissTeamStatus>;
  resolvedAtIso: string | null;
  /** Header label — overridden on the player-profile page (e.g. "[ STAGE I ]"). */
  title?: string;
}) {
  return (
    <div className="panel brk" style={{ padding: "18px 16px 20px" }}>
      <span className="br-tr" />
      <span className="br-bl" />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <span className="eyebrow-mono" style={{ color: "var(--heat)" }}>{title}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-low)" }}>
          {resolvedAtIso ? <LastUpdated iso={resolvedAtIso} /> : "Turns green / red as teams clinch"}
        </span>
      </div>

      <div className="pickboard">
        {section.groups.map((group) => {
          const groupPicks = myPicks[group.groupid] ?? {};
          const buckets = bucketSwissSlots(group.picks.length);
          const filled = Object.values(groupPicks).filter((p) => p > 0).length;
          return (
            <div key={group.groupid} className="pickgroup">
              <div className="pickgroup-head">
                <span className="pickgroup-name">{group.name.split(" | ")[0]}</span>
                <span className="pickgroup-pts">{filled}/{group.picks.length} LOCKED</span>
              </div>
              <div className="pickgroup-body">
                <div className="bucket-cols swiss">
                  {buckets.map((bucket) => (
                    <div key={bucket.label} className="bucket">
                      <div className="bucket-label">
                        <span>{bucket.label}</span>
                      </div>
                      {bucket.slotIndexes.map((slotIndex) => {
                        const pickId = groupPicks[slotIndex];
                        const team = pickId ? teamMap.get(pickId) : undefined;
                        if (!pickId || !team) {
                          return (
                            <div key={slotIndex} className="pslot" style={{ cursor: "default", minHeight: 96 }}>
                              <span className="pslot-ph">No pick</span>
                            </div>
                          );
                        }
                        const bucketFull = isPredictedBucketFull(
                          bucket.label,
                          pickId,
                          teamStatus.entries(),
                          bucket.slotIndexes.length,
                        );
                        const confirm = confirmPick(bucket.label, teamStatus.get(pickId), bucketFull);
                        const meta = CONFIRM_META[confirm];
                        return (
                          <div
                            key={slotIndex}
                            className={`pslot filled${meta.cls ? " " + meta.cls : ""}`}
                            style={{ cursor: "default" }}
                            title={`${team.name} — ${meta.title}`}
                          >
                            <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={LOGO} />
                            <span className="pslot-name">{team.name}</span>
                            {meta.mark && (
                              <span
                                aria-hidden="true"
                                style={{ position: "absolute", top: 6, right: 8, fontSize: 16, fontWeight: 800, color: meta.color }}
                              >
                                {meta.mark}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        /* Confirm colors layered on the picker's .pslot.filled look. */
        .pslot.pick-right { border-color: var(--tac-green, #9bd23c) !important; background: rgba(155,210,60,0.07); }
        .pslot.pick-right::before { background: var(--tac-green, #9bd23c) !important; }
        .pslot.pick-wrong { border-color: var(--ember, #d8351c) !important; background: rgba(216,53,28,0.07); }
        .pslot.pick-wrong::before { background: var(--ember, #d8351c) !important; }
      `}</style>
    </div>
  );
}
