import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { prisma } from "@/lib/db";
import { sessionize } from "@/lib/analytics-core";

export const dynamic = "force-dynamic";
export const metadata = { title: "Route traffic · HOTLINE" };

const RANGES = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "all", label: "All time", days: null as number | null },
];

// Kept out of the component body so the render stays "pure" (the now() read lives
// here, not inline in the server component).
function sinceDate(days: number | null): Date | undefined {
  if (days == null) return undefined;
  return new Date(Date.now() - days * 86_400_000);
}

type Row = { key: string; count: number };
function rows<T>(groups: T[], keyOf: (g: T) => string | null, countOf: (g: T) => number): Row[] {
  return groups
    .map((g) => ({ key: keyOf(g) ?? "—", count: countOf(g) }))
    .sort((a, b) => b.count - a.count);
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const CARD: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,.12)",
  borderRadius: 10,
  padding: ".75rem 1rem",
  marginBottom: "1rem",
};

function Breakdown({ title, data }: { title: string; data: Row[] }) {
  const max = data.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <div style={CARD}>
      <h2 style={{ fontSize: ".95rem", margin: "0 0 .5rem" }}>{title}</h2>
      {data.length === 0 ? (
        <p style={{ opacity: 0.5, margin: 0, fontSize: ".85rem" }}>No data yet.</p>
      ) : (
        data.slice(0, 12).map((r) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: ".5rem", margin: ".2rem 0", fontSize: ".88rem" }}>
            <span style={{ width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.key}</span>
            <span style={{ flex: 1, height: 8, background: "rgba(255,255,255,.08)", borderRadius: 4, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(r.count / max) * 100}%`, background: "rgba(255,180,80,.7)" }} />
            </span>
            <span style={{ width: 48, textAlign: "right", opacity: 0.8 }}>{r.count.toLocaleString()}</span>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * Owner-only analytics dashboard (PHA-1277). Reads the app's own PageView table —
 * no third-party tool, no separate container. Pageviews + cookieless visitors,
 * device/browser/OS/country, in-app events, sessions, and product metrics from
 * existing tables.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await getSession();
  if (!isOwner(session)) notFound();

  const { range = "30" } = await searchParams;
  const sel = RANGES.find((r) => r.key === range) ?? RANGES[1];
  const since = sinceDate(sel.days);
  const where = since ? { createdAt: { gte: since } } : undefined;
  const pvWhere = { ...where, event: null }; // pageviews only

  const [
    byPath,
    byDevice,
    byBrowser,
    byOs,
    byCountry,
    byReferrer,
    total,
    viewsForSessions,
    byEvent,
    totalPlayers,
    steamPlayers,
    newSignups,
    playersWithPicks,
    reactionsCount,
  ] = await Promise.all([
    prisma.pageView.groupBy({ by: ["path"], _count: { _all: true }, _max: { createdAt: true }, where: pvWhere, orderBy: { _count: { path: "desc" } }, take: 200 }),
    prisma.pageView.groupBy({ by: ["device"], _count: { _all: true }, where: pvWhere }),
    prisma.pageView.groupBy({ by: ["browser"], _count: { _all: true }, where: pvWhere }),
    prisma.pageView.groupBy({ by: ["os"], _count: { _all: true }, where: pvWhere }),
    prisma.pageView.groupBy({ by: ["country"], _count: { _all: true }, where: { ...pvWhere, country: { not: null } }, orderBy: { _count: { country: "desc" } }, take: 15 }),
    prisma.pageView.groupBy({ by: ["referrer"], _count: { _all: true }, where: { ...pvWhere, referrer: { not: null } }, orderBy: { _count: { referrer: "desc" } }, take: 10 }),
    prisma.pageView.count({ where: pvWhere }),
    prisma.pageView.findMany({ where: pvWhere, select: { visitor: true, path: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50_000 }),
    prisma.pageView.groupBy({ by: ["event", "label"], _count: { _all: true }, where: { ...where, event: { not: null } }, orderBy: { _count: { event: "desc" } }, take: 60 }),
    prisma.player.count(),
    prisma.player.count({ where: { steamId: { not: null } } }),
    prisma.player.count({ where }),
    prisma.pick.groupBy({ by: ["playerId"] }).then((r) => r.length),
    prisma.reaction.count(),
  ]);

  // Sessions from cookieless visitor hashes → unique visitors, bounce, duration.
  // viewsForSessions is capped at 50k rows; past that, session-derived metrics
  // (visitors/bounce/duration/entry/exit) are computed on a sample, so flag it.
  const truncated = viewsForSessions.length >= 50_000;
  const sessions = sessionize(viewsForSessions);
  const visitors = new Set(sessions.map((s) => s.visitor)).size;
  const bounces = sessions.filter((s) => s.views === 1).length;
  const bounceRate = sessions.length ? Math.round((bounces / sessions.length) * 100) : 0;
  // Average duration over ENGAGED (multi-view) sessions only — a single-view
  // bounce has start===end (duration 0) and can't measure time-on-page, so
  // including bounces would just drag the average toward zero.
  const engaged = sessions.filter((s) => s.views > 1);
  const avgDuration = engaged.length
    ? engaged.reduce((a, s) => a + (s.end.getTime() - s.start.getTime()), 0) / engaged.length
    : 0;
  const tally = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const k of arr) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  };
  const entries = tally(sessions.map((s) => s.entryPath)).slice(0, 8);
  const exits = tally(sessions.map((s) => s.exitPath)).slice(0, 8);

  const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "—");
  const fmtDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "1rem" }}>
      <h1 style={{ margin: "0 0 .25rem" }}>Route traffic</h1>
      <p style={{ opacity: 0.7, margin: "0 0 1rem", fontSize: ".9rem" }}>
        Anonymous, cookieless, self-hosted in this app. No PII — path + coarse
        device/browser/OS + country (no IP) + external referrer. Honors Do-Not-Track.
        Visitors/bounce/sessions use a daily-rotating id, so a visit crossing
        midnight (UTC) counts as two.
      </p>

      {truncated && (
        <p style={{ margin: "0 0 1rem", padding: ".5rem .75rem", borderRadius: 8, background: "rgba(255,180,80,.12)", border: "1px solid rgba(255,180,80,.4)", fontSize: ".85rem" }}>
          Over 50,000 pageviews in this range — visitor, bounce, session and
          entry/exit figures are computed on the most recent sample and are
          approximate. (View counts and breakdowns are exact.)
        </p>
      )}

      <div style={{ display: "flex", gap: ".5rem", marginBottom: "1rem" }}>
        {RANGES.map((r) => (
          <Link key={r.key} href={`/admin/analytics?range=${r.key}`} style={{ padding: ".3rem .7rem", borderRadius: 8, border: "1px solid rgba(255,255,255,.18)", textDecoration: "none", fontWeight: r.key === sel.key ? 700 : 400, background: r.key === sel.key ? "rgba(255,255,255,.12)" : "transparent" }}>
            {r.label}
          </Link>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
        {[
          { k: "Views", v: total.toLocaleString() },
          { k: "Visitors", v: visitors.toLocaleString() },
          { k: "Bounce", v: `${bounceRate}%` },
          { k: "Avg. session", v: fmtDuration(avgDuration) },
        ].map((s) => (
          <div key={s.k} style={{ ...CARD, marginBottom: 0, minWidth: 120, flex: "1 1 120px", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{s.v}</div>
            <div style={{ opacity: 0.65, fontSize: ".8rem" }}>{s.k}</div>
          </div>
        ))}
      </div>

      <div style={CARD}>
        <h2 style={{ fontSize: ".95rem", margin: "0 0 .5rem" }}>Routes</h2>
        {total === 0 ? (
          <p style={{ opacity: 0.6, margin: 0 }}>No pageviews recorded yet for this range.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,.2)" }}>
                <th style={{ padding: ".35rem .4rem" }}>Route</th>
                <th style={{ padding: ".35rem .4rem", textAlign: "right" }}>Views</th>
                <th style={{ padding: ".35rem .4rem", textAlign: "right" }}>Share</th>
                <th style={{ padding: ".35rem .4rem", textAlign: "right" }}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {byPath.slice(0, 100).map((r) => (
                <tr key={r.path} style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                  <td style={{ padding: ".35rem .4rem", fontFamily: "monospace" }}>{r.path}</td>
                  <td style={{ padding: ".35rem .4rem", textAlign: "right" }}>{r._count._all.toLocaleString()}</td>
                  <td style={{ padding: ".35rem .4rem", textAlign: "right", opacity: 0.7 }}>{pct(r._count._all)}</td>
                  <td style={{ padding: ".35rem .4rem", textAlign: "right", opacity: 0.7 }}>{fmtDay(r._max.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "1rem" }}>
        <Breakdown title="Device" data={rows(byDevice, (g) => g.device, (g) => g._count._all)} />
        <Breakdown title="Browser" data={rows(byBrowser, (g) => g.browser, (g) => g._count._all)} />
        <Breakdown title="OS" data={rows(byOs, (g) => g.os, (g) => g._count._all)} />
        <Breakdown title="Country" data={rows(byCountry, (g) => g.country, (g) => g._count._all)} />
        <Breakdown title="Top referrers" data={rows(byReferrer, (g) => g.referrer, (g) => g._count._all)} />
        <Breakdown title="Entry pages" data={entries} />
        <Breakdown title="Exit pages" data={exits} />
      </div>

      <div style={CARD}>
        <h2 style={{ fontSize: ".95rem", margin: "0 0 .5rem" }}>In-app events</h2>
        {byEvent.length === 0 ? (
          <p style={{ opacity: 0.6, margin: 0, fontSize: ".85rem" }}>
            No events yet — disclosure opens (FAQ/settings) and scroll depth show up here.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".88rem" }}>
            <tbody>
              {byEvent.map((e, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                  <td style={{ padding: ".3rem .4rem", fontFamily: "monospace" }}>{e.event}</td>
                  <td style={{ padding: ".3rem .4rem", opacity: 0.8 }}>{e.label ?? ""}</td>
                  <td style={{ padding: ".3rem .4rem", textAlign: "right" }}>{e._count._all.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={CARD}>
        <h2 style={{ fontSize: ".95rem", margin: "0 0 .5rem" }}>
          Product metrics <span style={{ opacity: 0.5, fontWeight: 400 }}>(from existing data, no tracking)</span>
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem", fontSize: ".9rem" }}>
          <span><strong>{totalPlayers.toLocaleString()}</strong> players ({steamPlayers} Steam-linked)</span>
          <span><strong>{newSignups.toLocaleString()}</strong> new ({sel.label.toLowerCase()})</span>
          <span><strong>{playersWithPicks.toLocaleString()}</strong> made picks</span>
          <span><strong>{reactionsCount.toLocaleString()}</strong> reactions</span>
        </div>
      </div>
    </div>
  );
}
