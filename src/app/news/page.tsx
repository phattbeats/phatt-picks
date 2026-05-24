import { MobileNav } from "@/components/ui/MobileNav";

export const metadata = { title: "News · phaTT Picks" };

/**
 * News is explicitly first on the handoff cut list ("mark cancelled, don't
 * silently drop"). Rather than a dead nav link, this is an honest degraded
 * state — the Beta floor is login + read + local picks + leaderboard.
 */
export default function NewsPage() {
  return (
    <>
      <div
        style={{ padding: "var(--space-4) var(--space-4) calc(72px + env(safe-area-inset-bottom) + var(--space-4))", position: "relative", zIndex: 1, minHeight: "100dvh", display: "flex", flexDirection: "column" }}
      >
        <header style={{ marginBottom: "var(--space-6)" }}>
          <h1 style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: "1.5rem", fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>
            News
          </h1>
        </header>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "var(--space-3)", color: "var(--text-low)" }}>
          <span style={{ fontSize: "2rem" }}>◉</span>
          <p style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: "1.125rem", fontWeight: 600, color: "var(--text-mid)", margin: 0 }}>
            Not in the Beta
          </p>
          <p style={{ fontSize: "0.875rem", maxWidth: 280, margin: 0, lineHeight: 1.5 }}>
            A match-news feed is planned for after the Cologne Beta. For now phaTT Picks stays focused on
            picks and the leaderboard.
          </p>
          <a href="/picks" style={{ color: "var(--accent)", fontSize: "0.875rem", marginTop: "var(--space-2)" }}>
            Go make your picks →
          </a>
        </div>
      </div>
      <MobileNav />
    </>
  );
}
