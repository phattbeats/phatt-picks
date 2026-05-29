import { Logo } from "@/components/ui/Logo";

/** Sign-in page — no nav, as per design spec. */
export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        gap: "var(--space-8)",
      }}
    >
      {/* Hero logo */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-4)" }}>
        <svg width="64" height="64" viewBox="0 0 40 40" fill="none">
          <line x1="6" y1="10" x2="12" y2="10" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="16" x2="12" y2="16" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="24" x2="12" y2="24" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="30" x2="12" y2="30" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="13" x2="18" y2="13" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="27" x2="18" y2="27" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="18" y1="20" x2="24" y2="20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="26" cy="20" r="3" fill="#ef4444" />
          <line x1="28" y1="20" x2="34" y2="20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <span
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: "2rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--text-hi)",
          }}
        >
          phaTT Picks
        </span>
        <p style={{ color: "var(--text-mid)", fontSize: "0.875rem", textAlign: "center", maxWidth: 280 }}>
          CS2 Major Pick&apos;Em companion for IEM Cologne 2026
        </p>
      </div>

      {/* Auth options */}
      <div style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <a
          href="/api/auth/steam"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-3)",
            background: "var(--accent)",
            color: "#fff",
            borderRadius: "var(--radius-md)",
            padding: "14px var(--space-6)",
            textDecoration: "none",
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 700,
            fontSize: "1rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            minHeight: 44,
            transition: `opacity var(--duration-fast) var(--ease-sharp)`,
          }}
        >
          Sign in with Steam
        </a>

        <a
          href="/login/local"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg2)",
            border: "1px solid var(--bg3)",
            color: "var(--text-mid)",
            borderRadius: "var(--radius-md)",
            padding: "14px var(--space-6)",
            textDecoration: "none",
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 600,
            fontSize: "1rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            minHeight: 44,
          }}
        >
          Play locally (no Steam)
        </a>
      </div>

      <p style={{ color: "var(--text-low)", fontSize: "0.75rem", textAlign: "center", maxWidth: 280 }}>
        Local mode is fully featured. Steam sync requires a CS2 Viewer Pass.
      </p>
    </div>
  );
}
