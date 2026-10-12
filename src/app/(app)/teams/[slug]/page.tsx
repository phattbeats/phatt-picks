/**
 * Team page (prototype 05) — portrait hero, stats, roster and the community
 * pick share for one team in the committed Major field. Read-only.
 *
 * Slug: the team's HLTV profile slug (e.g. /teams/natus-vincere), falling back
 * to its slugified name; the layout logo key (e.g. /teams/navi) also resolves.
 * Unknown slugs 404.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCommittedLayout } from "@/lib/layout";
import { findTeamBySlug, loadTeamPage } from "@/components/sg/teams/team-data";
import { TeamView } from "@/components/sg/teams/TeamView";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const team = findTeamBySlug(getCommittedLayout(), slug);
  return { title: team ? `${team.name} · HOTLINE` : "Team · HOTLINE" };
}

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Dynamic RSC — the reveal gate reads the clock per request.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const data = await loadTeamPage(slug, nowMs);
  if (!data) notFound();
  return <TeamView data={data} />;
}
