/**
 * Live playoffs bracket (#903) — the single-elim QF → SF → GF tree, Singapore
 * skin (prototype 04).
 *
 * Renders the bracket built upstream (buildPlayoffBracket): the structure comes
 * from our committed layout, the seeded teams + results fill in live as Stage 3
 * resolves. Three hairline columns (Quarterfinals / Semifinals / Grand Final)
 * that stack on mobile, the same grid as the picker above it so the two read as
 * one object — one is just live.
 *
 * Server component: data is built upstream and the picks page's <AutoRefresh>
 * re-renders it, so it tracks seeding + results without a reload. Truthful empty
 * state — an unseeded slot is TBD, a winner lights only once a real outcome
 * resolved it, no series score is invented.
 */

import Link from "next/link";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import { LastUpdated } from "@/components/LastUpdated";
import { teamHref } from "@/components/sg/teams/team-assets";
import {
  summarizePlayoffPicks,
  type PlayoffBracket,
  type PlayoffMatch,
  type PlayoffRoundKey,
  type PlayoffSide,
} from "@/lib/playoff-bracket-core";

// Friendly [singular, plural] round names for the "awaiting result" notice.
const ROUND_FRIENDLY: Record<PlayoffRoundKey, [string, string]> = {
  QF: ["Quarterfinal", "Quarterfinals"],
  SF: ["Semifinal", "Semifinals"],
  GF: ["Grand Final", "Grand Finals"],
};

/** Join 1–3 labels into prose: "A", "A & B", "A, B & C". */
function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
}

export function LivePlayoffBracket({
  bracket,
  teamMap,
  signedIn,
  resolvedAtIso,
}: {
  bracket: PlayoffBracket;
  teamMap: Map<number, TeamDef>;
  signedIn: boolean;
  resolvedAtIso: string | null;
}) {
  const { rounds } = bracket;
  if (rounds.length === 0) return null;

  const summary = summarizePlayoffPicks(bracket);
  const champ = bracket.championPickid != null ? teamMap.get(bracket.championPickid) : undefined;

  // Matches that have started but whose official Valve result hasn't landed yet
  // (#1016). Name the round(s) so a concluded-but-unpublished game reads as
  // "awaiting the official result" instead of looking identical to an undecided one.
  const awaitingRoundLabels = rounds
    .filter((rd) => rd.matches.some((m) => m.awaitingResult))
    .map((rd) => {
      const n = rd.matches.filter((m) => m.awaitingResult).length;
      return ROUND_FRIENDLY[rd.key][n > 1 ? 1 : 0];
    });

  return (
    <section className="sgb-board">
      <div className="sect-head">
        <h2 className="display sgb-h">Live bracket</h2>
        <span className="last-updated">
          {bracket.anyDecided && resolvedAtIso ? <LastUpdated iso={resolvedAtIso} /> : "Updates as matches finish"}
        </span>
      </div>

      <p className="sgb-copy">
        {bracket.anySeeded ? (
          <>
            Single elimination, quarters to the Grand Final. <b>Your calls carry the amber bar.</b>
          </>
        ) : (
          <>
            The bracket seeds as Stage&nbsp;3 resolves. Until then <b>every slot is TBD</b>.
          </>
        )}
      </p>

      {/* Awaiting-official-result notice (#1016): names the round(s) whose game
          has started but whose Valve answer key hasn't published yet. */}
      {awaitingRoundLabels.length > 0 && !champ && (
        <p className="sgb-note">
          <span className="tag warn">Awaiting result</span>
          <span>
            <b>{joinLabels(awaitingRoundLabels)}</b> — it lands here the moment Valve makes it final.
          </span>
        </p>
      )}

      {champ && (
        <div className="sgb-crown">
          <span className="sgb-tile">
            <TeamLogo tiers={resolveLogoTiers(champ)} teamName={champ.name} size={28} />
          </span>
          <span>
            <span className="eyebrow">
              <b>Champion</b>
            </span>
            <Link href={teamHref(champ)} prefetch={false} className="nm">
              {champ.name}
            </Link>
          </span>
        </div>
      )}

      {signedIn && summary.picks > 0 && (
        <p className="sgb-copy">
          {summary.hits + summary.misses > 0 ? (
            <>
              <b>{summary.hits}</b> of your <b>{summary.picks}</b> bracket calls have hit
              {summary.pending > 0 ? ` · ${summary.pending} still in play` : ""}.
            </>
          ) : (
            <>
              Your <b>{summary.picks}</b> bracket calls are locked. Results land here as matches finish.
            </>
          )}
        </p>
      )}

      <div className="sgb-grid">
        {rounds.map((round) => (
          <div key={round.key} className="sgb-rd">
            <div className="sgb-k">
              <span>{ROUND_FRIENDLY[round.key][round.key === "GF" ? 0 : 1]}</span>
              <span className="muted">{round.matches.length === 1 ? "1 match" : `${round.matches.length} matches`}</span>
            </div>
            {round.matches.map((m) => (
              <MatchCell key={m.groupId} match={m} teamMap={teamMap} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function MatchCell({ match, teamMap }: { match: PlayoffMatch; teamMap: Map<number, TeamDef> }) {
  // A match that has started but hasn't resolved yet gets a brighter hairline
  // so the eye finds the in-flight game (#1016).
  return (
    <div className={`sgb-mt${match.awaitingResult && !match.decided ? " await" : ""}`}>
      <SideRow side={match.team1} played={match.decided} awaiting={match.awaitingResult} teamMap={teamMap} />
      <SideRow side={match.team2} played={match.decided} awaiting={match.awaitingResult} teamMap={teamMap} />
    </div>
  );
}

function SideRow({
  side,
  played,
  awaiting,
  teamMap,
}: {
  side: PlayoffSide;
  played: boolean;
  awaiting: boolean;
  teamMap: Map<number, TeamDef>;
}) {
  const team = side.pickid != null ? teamMap.get(side.pickid) : undefined;
  const tbd = side.pickid == null;
  const lost = played && !side.winner && !tbd;
  const won = played && side.winner;

  if (tbd || !team) {
    return (
      <div className="sgb-sd tbd">
        <span className="sgb-tile" aria-hidden="true" />
        <span className="nm">TBD</span>
      </div>
    );
  }

  return (
    <div className={`sgb-sd${side.userPicked ? " pk" : ""}${lost ? " lo" : ""}${won ? " won" : ""}`}>
      <span className="sgb-tile">
        <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={24} />
      </span>
      <span className="nm">
        <Link href={teamHref(team)} prefetch={false} data-tip="team-link">
          {team.name}
        </Link>
        {side.userPicked && <span className="sgb-call">Your call</span>}
      </span>
      {/* score column: a live overlay score, the winner's ✓ once decided, or an
          "awaiting" mark where the ✓ will land while we await the result. */}
      <span className="sgb-score">
        {side.score != null ? (
          side.score
        ) : won ? (
          <span className="sgb-tick">✓</span>
        ) : awaiting ? (
          <span aria-label="awaiting result" title="Awaiting official result">
            …
          </span>
        ) : null}
      </span>
    </div>
  );
}
