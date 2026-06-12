/**
 * Live Swiss lineup (PHA-898) — the post-lock view for a Swiss stage.
 *
 * Once a stage locks we drop the picker and render this instead. Two sections:
 *   1. YOUR BUILD — the viewer's picks kept in the exact 3:0 / advance / 0:3
 *      structure they called, with logos, marked ✓/✗/pending as teams clinch.
 *      Brandon: "keep the 0-3 advancing 3-0 build, it shouldn't disappear."
 *   2. THE FIELD — all 16 teams grouped by current clinch status.
 *
 * Server component — the data is built upstream (buildSwissStandings) from the
 * resolved answer key, which the on-read driver keeps fresh; the <AutoRefresh>
 * sibling re-renders the route so it tracks results without a reload. Honest
 * empty state: pre-clinch every team sits in "still in contention", and we
 * never invent a win-loss record Valve hasn't confirmed. The richer HLTV/BLAST
 * style live W-L standings is a separate, hourly-refreshed feature (follow-up).
 */

import type { CSSProperties } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import type { TeamDef } from "@/lib/layout";
import {
  SWISS_STATUS_GROUPS,
  type SwissStandings,
  type SwissTeamStatus,
  type SwissUserPick,
} from "@/lib/swiss-standings-core";
import { LastUpdated } from "@/components/LastUpdated";

const STATUS_ACCENT: Record<SwissTeamStatus, string> = {
  "advanced-3-0": "var(--tac-green, #9bd23c)",
  advanced: "var(--tac-green, #9bd23c)",
  live: "var(--ink-mid)",
  eliminated: "var(--ember, #d8351c)",
};

export function LiveSwissBracket({
  standings,
  teamMap,
  signedIn,
  resolvedAtIso,
}: {
  standings: SwissStandings;
  teamMap: Map<number, TeamDef>;
  signedIn: boolean;
  resolvedAtIso: string | null;
}) {
  // pickid -> the viewer's result for that team (hit / miss / pending).
  const resultByTeam = new Map<number, SwissUserPick["result"]>();
  for (const p of standings.userPicks) resultByTeam.set(p.pickid, p.result);

  const started = standings.resolvedTeamCount > 0;

  // The viewer's "build" — their picks grouped by the bucket they slotted each
  // team into (3:0 / advance / 0:3), in slot order. Brandon: keep this, it
  // shouldn't vanish when the stage locks. Map keeps insertion order, and we
  // insert in slot order, so the first-seen label (lowest slot) leads → the
  // buckets come out 3:0 → advance → 0:3.
  const buildBuckets: { label: string; picks: SwissUserPick[] }[] = [];
  {
    const byLabel = new Map<string, SwissUserPick[]>();
    for (const p of [...standings.userPicks].sort((a, b) => a.slotIndex - b.slotIndex)) {
      const bucket = byLabel.get(p.bucketLabel);
      if (bucket) bucket.push(p);
      else byLabel.set(p.bucketLabel, [p]);
    }
    for (const [label, picks] of byLabel) buildBuckets.push({ label, picks });
  }
  const showBuild = signedIn && buildBuckets.length > 0;

  return (
    <div className="panel brk" style={{ padding: "20px 18px 22px" }}>
      <span className="br-tr" />
      <span className="br-bl" />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="eyebrow-mono" style={{ color: "var(--heat)" }}>
          [ LIVE LINEUP ]
        </span>
        <span className="last-updated">
          {started && resolvedAtIso ? (
            <LastUpdated iso={resolvedAtIso} />
          ) : (
            "Updates as matches finish"
          )}
        </span>
      </div>

      {/* Your-picks summary */}
      {signedIn && standings.userTotal > 0 && (
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "10px 0 0", lineHeight: 1.5 }}>
          {started ? (
            <>
              <strong style={{ color: "var(--ink-hi)" }}>{standings.userHits}</strong> of your{" "}
              <strong style={{ color: "var(--ink-hi)" }}>{standings.userTotal}</strong> calls have
              hit so far{standings.userPending > 0 ? ` · ${standings.userPending} still in play` : ""}.
            </>
          ) : (
            <>Your <strong style={{ color: "var(--ink-hi)" }}>{standings.userTotal}</strong> calls are
              locked. Results land here as teams clinch.</>
          )}
        </p>
      )}
      {signedIn && standings.userTotal === 0 && (
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "10px 0 0" }}>
          You didn&apos;t lock any picks for this stage — follow the field below.
        </p>
      )}

      {/* YOUR BUILD — the viewer's picks, kept in their 3:0 / advance / 0:3
          structure so the locked stage still shows exactly what they called. */}
      {showBuild && (
        <div style={{ marginTop: 16 }}>
          <div className="eyebrow-mono" style={{ color: "var(--ink-mid)", marginBottom: 10, display: "block" }}>
            [ YOUR BUILD ]
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {buildBuckets.map(({ label, picks }) => (
              <div key={label}>
                <div style={bucketLabelStyle}>{label}</div>
                <div className="swiss-grid">
                  {picks.map((p) => {
                    const team = teamMap.get(p.pickid);
                    return (
                      <div key={`${p.groupId}:${p.slotIndex}`} className="brk" style={buildTileStyle}>
                        {team ? (
                          <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={30} />
                        ) : (
                          <div style={{ width: 30, height: 30 }} />
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={teamNameStyle}>{team?.name ?? `#${p.pickid}`}</div>
                          <div style={yourPickTagStyle}>Your call</div>
                        </div>
                        <ResultBadge result={p.result} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* THE FIELD — all 16 teams by current clinch status. */}
      <div className="eyebrow-mono" style={{ color: "var(--ink-mid)", margin: "20px 0 0", display: "block" }}>
        [ THE FIELD ]
      </div>
      {/* Status columns */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
        {SWISS_STATUS_GROUPS.map(({ status, label }) => {
          const rows = standings.teams.filter((t) => t.status === status);
          if (rows.length === 0) return null;
          return (
            <div key={status}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-low)",
                  marginBottom: 8,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_ACCENT[status], flexShrink: 0 }} />
                {label}
                <span style={{ color: "var(--ink-low)", opacity: 0.7 }}>· {rows.length}</span>
              </div>
              <div className="swiss-grid">
                {rows.map((row) => {
                  const team = teamMap.get(row.pickid);
                  const result = resultByTeam.get(row.pickid);
                  const mine = row.userPicked;
                  return (
                    <div
                      key={row.pickid}
                      className="brk"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 11px",
                        background: mine ? "rgba(240,163,0,0.07)" : "var(--surf-1)",
                        border: mine ? "1px solid var(--hair-3)" : "1px solid var(--hair)",
                        position: "relative",
                      }}
                    >
                      {team ? (
                        <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={28} />
                      ) : (
                        <div style={{ width: 28, height: 28 }} />
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: "var(--ink-hi)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {team?.name ?? `#${row.pickid}`}
                        </div>
                        {mine && (
                          <div
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 8,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              color: "var(--heat)",
                            }}
                          >
                            Your pick
                          </div>
                        )}
                      </div>
                      {mine && result && (
                        <span
                          aria-hidden="true"
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color:
                              result === "hit"
                                ? "var(--tac-green, #9bd23c)"
                                : result === "miss"
                                  ? "var(--ember, #d8351c)"
                                  : "var(--ink-low)",
                          }}
                          title={result === "hit" ? "Called it" : result === "miss" ? "Landed elsewhere" : "Still in play"}
                        >
                          {result === "hit" ? "✓" : result === "miss" ? "✗" : "·"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .swiss-grid { display: grid; grid-template-columns: 1fr; gap: 6px; }
        @media (min-width: 480px) { .swiss-grid { grid-template-columns: 1fr 1fr; } }
      `}</style>
    </div>
  );
}

const bucketLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--ink-low)",
  marginBottom: 8,
};

const buildTileStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 11px",
  background: "rgba(240,163,0,0.07)",
  border: "1px solid var(--hair-3)",
  position: "relative",
};

const teamNameStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--ink-hi)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const yourPickTagStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 8,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--heat)",
};

function ResultBadge({ result }: { result: SwissUserPick["result"] }) {
  return (
    <span
      aria-hidden="true"
      style={{
        fontSize: 14,
        fontWeight: 700,
        color:
          result === "hit"
            ? "var(--tac-green, #9bd23c)"
            : result === "miss"
              ? "var(--ember, #d8351c)"
              : "var(--ink-low)",
      }}
      title={result === "hit" ? "Called it" : result === "miss" ? "Landed elsewhere" : "Still in play"}
    >
      {result === "hit" ? "✓" : result === "miss" ? "✗" : "·"}
    </span>
  );
}
