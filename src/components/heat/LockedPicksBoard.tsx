/**
 * Locked picks board (#902) — the picker UI, frozen, with your calls.
 *
 * Brandon: once a Swiss stage locks, drop the "YOUR BUILD / THE FIELD" lineup and
 * instead keep the SAME UI where you made your picks — the 3:0 / advance / 0:3
 * bucket slots — with the teams you locked in, then turn each one green when it's
 * confirmed right and red when it's confirmed wrong.
 *
 * Read-only mirror of <PicksBoard>: the same Singapore bucket rows (.sgp-slot),
 * minus the team pool and any interaction. Each filled slot is marked by
 * confirmPick() against the live answer key (StageOutcome): green = the team
 * landed in the bucket you called, red = it clinched a different one, neutral =
 * still in play. Singapore §3: an inset green / red bar, the live record, and
 * `+pts` or ✕. Honest: nothing turns green/red until the answer key confirms it.
 */

import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { Section, TeamDef } from "@/lib/layout";
import { bucketSwissSlots } from "@/lib/swiss-bucket-core";
import {
  confirmPick,
  isPredictedBucketFull,
  isBucketImpossibleByRecord,
  type SwissTeamStatus,
  type PickConfirm,
  type TeamRecord,
} from "@/lib/swiss-standings-core";
import { LastUpdated } from "@/components/LastUpdated";
import { BleachersStrip, type TallyLine } from "@/components/heat/BleachersStrip";
import { bucketDisplay } from "@/components/sg/picks/team-art";

const LOGO = 26;

const CONFIRM_META: Record<PickConfirm, { cls: string; title: string }> = {
  right: { cls: "good", title: "Called it" },
  wrong: { cls: "bad", title: "Landed elsewhere" },
  pending: { cls: "", title: "Still in play" },
};

export function LockedPicksBoard({
  section,
  teamMap,
  myPicks,
  teamStatus,
  recordByTeam,
  resolvedAtIso,
  title = "YOUR LOCKED PICKS",
  reactions,
  bare = false,
}: {
  section: Section;
  teamMap: Map<number, TeamDef>;
  /** groupId -> slotIndex -> pickId (the viewer's locked picks). */
  myPicks: Record<number, Record<number, number>>;
  /** pickId -> answer-key status, from the live standings. */
  teamStatus: Map<number, SwissTeamStatus>;
  /** pickId -> partial live W-L record (#951) — strikes a 3:0/0:3 pick red
   *  early once the team's record makes its bucket impossible. Optional: omit
   *  (or pass an empty map) and the board falls back to terminal-only confirms. */
  recordByTeam?: Map<number, TeamRecord>;
  resolvedAtIso: string | null;
  /** Header label — overridden on the player-profile page (e.g. "STAGE I"). */
  title?: string;
  /** When viewing another player's picks: render BleachersStrip under each slot. */
  reactions?: {
    targetPlayerId: string;
    canReact: boolean;
    tallyFor: (groupId: number, slotIndex: number) => TallyLine[];
  };
  /** Drop the title row — for when an outer wrapper (e.g. the collapsible
   *  stage card on the profile, #1283) already supplies it. */
  bare?: boolean;
}) {
  return (
    <div className="sgp-locked">
      {!bare && (
        <div className="sgp-locked-head">
          <span className="eyebrow">{title}</span>
          <span className="last-updated">
            {resolvedAtIso ? <LastUpdated iso={resolvedAtIso} /> : "Turns green / red as teams clinch"}
          </span>
        </div>
      )}

      {section.groups.map((group) => {
        const groupPicks = myPicks[group.groupid] ?? {};
        const buckets = bucketSwissSlots(group.picks.length);
        const pts = group.points_per_pick;
        return (
          <div key={group.groupid} className={`sgp-locked-cols${buckets.length === 3 ? " swiss" : ""}`}>
            {buckets.map((bucket) => {
              const disp = bucketDisplay(bucket.label);
              const placed = bucket.slotIndexes.filter((i) => groupPicks[i] > 0).length;
              return (
                <div key={bucket.label} className="sgp-bucket">
                  <div className="sgp-bk">
                    <span>{disp.title}</span>
                    <b>
                      {placed}/{bucket.slotIndexes.length}
                    </b>
                  </div>
                  {bucket.slotIndexes.map((slotIndex) => {
                    const pickId = groupPicks[slotIndex];
                    const team = pickId ? teamMap.get(pickId) : undefined;
                    if (!pickId || !team) {
                      return (
                        <div key={slotIndex} className="sgp-slot ro">
                          <span className="ph">No pick</span>
                        </div>
                      );
                    }
                    const bucketFull = isPredictedBucketFull(
                      bucket.label,
                      pickId,
                      teamStatus.entries(),
                      bucket.slotIndexes.length,
                    );
                    const rec = recordByTeam?.get(pickId);
                    const impossible = isBucketImpossibleByRecord(bucket.label, rec);
                    const confirm = confirmPick(bucket.label, teamStatus.get(pickId), bucketFull, impossible);
                    const meta = CONFIRM_META[confirm];
                    return (
                      <div
                        key={slotIndex}
                        className={`sgp-slot on ro${meta.cls ? ` ${meta.cls}` : ""}`}
                        title={`${team.name} — ${meta.title}`}
                      >
                        <span className="sgp-mark" aria-hidden="true">
                          <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={LOGO} />
                        </span>
                        <span className="nm">{team.name}</span>
                        {rec && (
                          <span className="rec">
                            {rec.wins}–{rec.losses}
                          </span>
                        )}
                        {confirm === "right" ? (
                          <span className="hit">
                            +{pts}
                          </span>
                        ) : confirm === "wrong" ? (
                          <span className="miss">
                            ✕
                          </span>
                        ) : (
                          <span className="pend" aria-hidden="true">
                            ·
                          </span>
                        )}
                        {reactions && (
                          <BleachersStrip
                            targetPlayerId={reactions.targetPlayerId}
                            sectionId={section.sectionid}
                            groupId={group.groupid}
                            slotIndex={slotIndex}
                            initialTally={reactions.tallyFor(group.groupid, slotIndex)}
                            canReact={reactions.canReact}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
