import Link from "next/link";
import { HeatMark, HeatWordmark } from "@/components/heat/HeatMark";

/** Sign-in page — auth options after the splash gate. */
export default function AuthPage() {
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
      }}
    >
      {/* Hero crest */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <HeatMark size={72} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <HeatWordmark size={48} />
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--ink-mid)",
          }}>
            IEM Cologne 2026 · Pick&apos;Em Companion
          </span>
        </div>
      </div>

      {/* Auth panel — note from phatt */}
      <div className="panel brk" style={{
        maxWidth: 360,
        width: "100%",
        padding: "20px 22px",
      }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <p className="eyebrow-mono" style={{ marginBottom: 8 }}>
          [ AUTH ]
        </p>
        <p style={{
          color: "var(--ink-mid)",
          fontSize: 13,
          margin: "0 0 16px",
          lineHeight: 1.55,
        }}>
          Two ways in. Steam syncs your official Valve picks. Local plays the same game without a Viewer Pass.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <a href="/api/auth/steam" className="btn-heat" style={{ width: "100%" }}>
            Sign in with Steam
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </a>
          <Link href="/login/local" className="btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
            Play locally
          </Link>
        </div>
      </div>

      <p style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ink-low)",
        textAlign: "center",
        maxWidth: 320,
        margin: 0,
      }}>
        Local mode is fully featured. Steam sync needs a CS2 Viewer Pass.
      </p>
    </main>
  );
}
