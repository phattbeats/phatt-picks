import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { prisma } from "@/lib/db";

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

/**
 * Owner-only route-traffic dashboard (PHA-1277). Reads the app's own PageView
 * table — no third-party tool, no separate container. Shows which routes get
 * traffic so the next declutter is evidence-based.
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

  const [byPath, byDevice, byReferrer, total] = await Promise.all([
    prisma.pageView.groupBy({
      by: ["path"],
      _count: { _all: true },
      _max: { createdAt: true },
      where,
      orderBy: { _count: { path: "desc" } },
      take: 200,
    }),
    prisma.pageView.groupBy({ by: ["device"], _count: { _all: true }, where }),
    prisma.pageView.groupBy({
      by: ["referrer"],
      _count: { _all: true },
      where: { ...where, referrer: { not: null } },
      orderBy: { _count: { referrer: "desc" } },
      take: 10,
    }),
    prisma.pageView.count({ where }),
  ]);

  const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "—");
  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "1rem" }}>
      <h1 style={{ margin: "0 0 .25rem" }}>Route traffic</h1>
      <p style={{ opacity: 0.7, margin: "0 0 1rem", fontSize: ".9rem" }}>
        Anonymous pageviews, self-hosted in this app. No cookies, no PII — path +
        coarse device + external referrer only. Honors Do-Not-Track.
      </p>

      <div style={{ display: "flex", gap: ".5rem", marginBottom: "1rem" }}>
        {RANGES.map((r) => (
          <Link
            key={r.key}
            href={`/admin/analytics?range=${r.key}`}
            style={{
              padding: ".3rem .7rem",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,.18)",
              textDecoration: "none",
              fontWeight: r.key === sel.key ? 700 : 400,
              background: r.key === sel.key ? "rgba(255,255,255,.12)" : "transparent",
            }}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <p style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>
        <strong>{total.toLocaleString()}</strong> views ({sel.label.toLowerCase()})
        {byDevice.length > 0 && (
          <span style={{ opacity: 0.7, fontSize: ".9rem" }}>
            {" — "}
            {byDevice
              .sort((a, b) => b._count._all - a._count._all)
              .map((d) => `${d.device} ${d._count._all}`)
              .join(" · ")}
          </span>
        )}
      </p>

      {total === 0 ? (
        <p style={{ opacity: 0.7 }}>No pageviews recorded yet for this range.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".95rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,.2)" }}>
              <th style={{ padding: ".4rem .5rem" }}>Route</th>
              <th style={{ padding: ".4rem .5rem", textAlign: "right" }}>Views</th>
              <th style={{ padding: ".4rem .5rem", textAlign: "right" }}>Share</th>
              <th style={{ padding: ".4rem .5rem", textAlign: "right" }}>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {byPath.map((row) => (
              <tr key={row.path} style={{ borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                <td style={{ padding: ".4rem .5rem", fontFamily: "monospace" }}>{row.path}</td>
                <td style={{ padding: ".4rem .5rem", textAlign: "right" }}>
                  {row._count._all.toLocaleString()}
                </td>
                <td style={{ padding: ".4rem .5rem", textAlign: "right", opacity: 0.7 }}>
                  {pct(row._count._all)}
                </td>
                <td style={{ padding: ".4rem .5rem", textAlign: "right", opacity: 0.7 }}>
                  {fmt(row._max.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {byReferrer.length > 0 && (
        <>
          <h2 style={{ fontSize: "1rem", margin: "1.5rem 0 .5rem" }}>Top external referrers</h2>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", opacity: 0.85 }}>
            {byReferrer.map((r) => (
              <li key={r.referrer}>
                {r.referrer} — {r._count._all.toLocaleString()}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
