/**
 * ConsensusBar (PHA-889) — field-wide pick distribution for one slot.
 *
 * Renders "X% of players picked this team" as a stacked set of labeled bars,
 * most-popular first. Highlights the viewer's own pick and marks the winning
 * team once resolved. Presentational + server-safe; the CSS lives in
 * globals.css (`.consensus-*`) so it ships once, not per-instance.
 *
 * Callers gate visibility: a slot's split is only handed in AFTER its stage
 * locks/resolves (herd-following guard, mirrors reveal-core). This component
 * just draws whatever consensus it's given.
 */

import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import type { SlotConsensus } from "@/lib/consensus-core";

export function ConsensusBar({
  consensus,
  teamMap,
  highlightPickId,
  winnerPickId,
  max = 4,
}: {
  consensus: SlotConsensus | null | undefined;
  teamMap: Map<number, TeamDef>;
  /** The viewer's own pick for this slot — rendered with a "you" accent. */
  highlightPickId?: number;
  /** The resolved winner, if any — rendered with a ✓. */
  winnerPickId?: number;
  /** Cap the rows shown; the rest fold into a "+N more" footer. */
  max?: number;
}) {
  if (!consensus || consensus.total === 0) return null;
  const shown = consensus.shares.slice(0, max);
  const hidden = consensus.shares.length - shown.length;

  return (
    <div className="consensus">
      <div className="consensus-head">
        <span className="consensus-lbl">[ Field Split ]</span>
        <span className="consensus-n">{consensus.total} picked</span>
      </div>
      {shown.map((s) => {
        const team = teamMap.get(s.pickId);
        const isYou = highlightPickId != null && highlightPickId === s.pickId;
        const isWinner = winnerPickId != null && winnerPickId === s.pickId;
        return (
          <div key={s.pickId} className={`consensus-row${isYou ? " you" : ""}${isWinner ? " win" : ""}`}>
            <span className="consensus-fill" style={{ width: `${s.pct}%` }} aria-hidden="true" />
            {team && team.pickid !== 0 ? (
              <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={18} />
            ) : (
              <span className="consensus-dot" aria-hidden="true" />
            )}
            <span className="consensus-name">
              {team?.name ?? `#${s.pickId}`}
              {isWinner && <span className="consensus-check" aria-label="winner"> ✓</span>}
              {isYou && <span className="consensus-you"> · you</span>}
            </span>
            <span className="consensus-pct">{s.pct}%</span>
          </div>
        );
      })}
      {hidden > 0 && <div className="consensus-more">+{hidden} more</div>}
    </div>
  );
}
