/**
 * Live Swiss bracket + Simulate switch (PHA-5453). Server wrapper: renders the
 * unchanged LiveSwissBracketBoard and, when this stage can be seeded from
 * Valve's published data AND our engine reproduces every real match-up so far,
 * hands the client simulator its input. Otherwise it renders the plain board
 * (no switch) and logs why — we never draw pairings we can't stand behind.
 *
 * The simulator's data is tiny (16 seeds, ≤ 35 matches, 16 point values) and
 * computed from caches the page already reads; the only extra I/O is the
 * previous stages' cached brackets for Stage II/III seeding.
 */

import type { ComponentProps } from "react";
import type { Layout } from "@/lib/layout";
import { buildTeamMap } from "@/lib/layout";
import { resolveLogoTiers } from "@/lib/logos";
import { isSwissSection } from "@/lib/swiss-bucket-core";
import { getSwissBracket } from "@/lib/swiss-results";
import { buildSimInput } from "@/lib/swiss-sim-input";
import { preEventSeeding } from "@/lib/swiss-sim-seeds";
import type { SwissRound } from "@/lib/swiss-bracket-core";
import { LiveSwissBracketBoard } from "./LiveSwissBracketBoard";
import { SwissSimulator, type SimTeamView } from "./SwissSimulator";

export async function LiveSwissBracketSim({
  eventId,
  sectionId,
  layout,
  ...board
}: ComponentProps<typeof LiveSwissBracketBoard> & { eventId: number; sectionId: number; layout: Layout }) {
  const plain = <LiveSwissBracketBoard {...board} />;
  if (board.rounds.length === 0) return plain;
  const seeding = preEventSeeding(eventId);
  if (!seeding) return plain;

  const swiss = layout.sections.filter((s) => isSwissSection(s.sectionid)).sort((a, b) => a.sectionid - b.sectionid);
  const stageIndex = swiss.findIndex((s) => s.sectionid === sectionId);
  if (stageIndex < 0) return plain;

  const stageTeams = swiss.map((s) => s.groups.flatMap((g) => g.teams.map((t) => t.pickid)).filter((id) => id > 0));
  const matchTeams = layout.teams.map((t) => ({ pickid: t.pickid, name: t.name }));
  const stageRounds: (SwissRound[] | null)[] = [];
  for (let i = 0; i < stageIndex; i++) {
    stageRounds.push((await getSwissBracket(eventId, swiss[i].sectionid, matchTeams))?.rounds ?? null);
  }
  stageRounds.push(board.rounds);

  const { input, reason } = buildSimInput({ seeding, stageIndex, stageTeams, stageRounds });
  if (!input) {
    console.warn(`[swiss-sim] event ${eventId} section ${sectionId}: simulator off — ${reason}`);
    return plain;
  }

  const teamMap = buildTeamMap(layout);
  const teams: Record<string, SimTeamView> = {};
  for (const id of input.seeds) {
    const t = teamMap.get(Number(id));
    if (t) teams[id] = { name: t.name, tiers: resolveLogoTiers(t) };
  }

  return (
    <SwissSimulator storageKey={`${eventId}:${sectionId}`} input={input} teams={teams}>
      {plain}
    </SwissSimulator>
  );
}
