import Link from "next/link";

export const metadata = { title: "Wire · HOTLINE" };

/**
 * News is explicitly first on the handoff cut list ("mark cancelled, don't
 * silently drop"). Rather than a dead nav link, this is an honest degraded
 * state — the Beta floor is login + read + local picks + leaderboard.
 */
export default function NewsPage() {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">[ THE_WIRE ]</span>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: "clamp(28px, 5vw, 40px)",
          textTransform: "uppercase",
          lineHeight: 0.95,
        }}>
          News
        </h1>
      </div>

      <section className="panel brk" style={{ padding: "44px 24px", textAlign: "center" }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--heat)",
          marginBottom: 14,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{
            display: "inline-block",
            width: 6,
            height: 6,
            background: "var(--heat)",
            boxShadow: "0 0 8px var(--heat)",
            animation: "live-blink 1.4s steps(2, end) infinite",
          }} />
          Scanning frequencies
        </div>
        <p className="font-display" style={{
          fontWeight: 800,
          fontSize: 24,
          color: "var(--ink-hi)",
          textTransform: "uppercase",
          margin: "0 0 8px",
          letterSpacing: "0.01em",
        }}>
          No signal yet
        </p>
        <p style={{
          color: "var(--ink-mid)",
          fontSize: 14,
          maxWidth: 320,
          margin: "0 auto 18px",
          lineHeight: 1.55,
        }}>
          A match-news feed is planned for after the Cologne Beta. For now HOTLINE stays focused on picks and the leaderboard.
        </p>
        <Link href="/picks" className="btn-heat">
          Go make your picks
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      </section>
    </>
  );
}
