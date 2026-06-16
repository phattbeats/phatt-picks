import Link from "next/link";
import { HeatMark, HeatWordmark } from "@/components/heat/HeatMark";

/**
 * Global 404 — a branded, navigable dead-end stop. Without this, unknown URLs
 * fall through to Next's unstyled default with no way back into the app.
 */
export default function NotFound() {
  return (
    <main
      style={{
        position: "relative",
        zIndex: 3,
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        gap: 28,
        textAlign: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <HeatMark size={64} />
        <HeatWordmark size={36} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, maxWidth: 340 }}>
        <span className="eyebrow-mono">NO SIGNAL · 404</span>
        <h1
          className="font-display"
          style={{
            fontWeight: 800,
            fontSize: "clamp(28px, 7vw, 40px)",
            textTransform: "uppercase",
            lineHeight: 1,
            color: "var(--ink-hi)",
            margin: 0,
          }}
        >
          Off the map
        </h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 14, lineHeight: 1.55, margin: 0 }}>
          This page isn&apos;t on the board. Let&apos;s get you back in the game.
        </p>
      </div>

      <Link href="/" className="btn-heat" style={{ minWidth: 168, justifyContent: "center" }}>
        Back to HOTLINE
        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </Link>
    </main>
  );
}
