import { MobileNav } from "@/components/ui/MobileNav";
import { PushToggle } from "@/components/PushToggle";
import { InviteLink } from "@/components/InviteLink";
import { getSession } from "@/lib/session";

const cardStyle: React.CSSProperties = {
  background: "var(--bg1)",
  border: "1px solid var(--bg3)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-4)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
};

const sectionLabel: React.CSSProperties = {
  fontFamily: "'Rajdhani', sans-serif",
  fontSize: "0.6875rem",
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-low)",
  margin: 0,
};

/** Profile / settings hub — identity, push opt-in, invite, install, account. */
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) return <SignedOutProfile />;

  const connected = Boolean(session.steamId);
  const initials = session.displayName.slice(0, 2).toUpperCase();

  return (
    <>
      <div style={{ padding: "var(--space-4) var(--space-4) calc(72px + env(safe-area-inset-bottom) + var(--space-4))", position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <header style={{ marginBottom: "var(--space-2)" }}>
          <h1 style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: "1.5rem", fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>
            You
          </h1>
        </header>

        {/* Identity */}
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "var(--bg3)",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "'Rajdhani', sans-serif",
                fontWeight: 700,
                color: "var(--text-mid)",
              }}
            >
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: "1.0625rem", color: "var(--text-hi)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session.displayName}
              </p>
              <p style={{ fontSize: "0.8125rem", color: connected ? "var(--info)" : "var(--text-mid)", margin: "2px 0 0" }}>
                {connected ? "Steam-synced player" : "Local player"}
              </p>
            </div>
          </div>
          {!connected && (
            <a
              href="/api/auth/steam"
              style={{
                textAlign: "center",
                background: "var(--bg2)",
                border: "1px solid var(--bg3)",
                color: "var(--text-mid)",
                borderRadius: "var(--radius-md)",
                padding: "10px",
                textDecoration: "none",
                fontFamily: "'Rajdhani', sans-serif",
                fontWeight: 600,
                fontSize: "0.875rem",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                minHeight: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              Connect Steam to sync official picks
            </a>
          )}
        </div>

        {/* Notifications */}
        <div style={cardStyle}>
          <p style={sectionLabel}>Pick-lock reminders</p>
          <PushToggle />
        </div>

        {/* Invite */}
        <div style={cardStyle}>
          <p style={sectionLabel}>Invite friends</p>
          <p style={{ color: "var(--text-mid)", fontSize: "0.875rem", margin: 0 }}>
            Send this link. They land on a one-tap join page — no account hunting.
          </p>
          <InviteLink />
        </div>

        {/* Install */}
        <div style={cardStyle}>
          <p style={sectionLabel}>Install the app</p>
          <p style={{ color: "var(--text-mid)", fontSize: "0.875rem", margin: 0, lineHeight: 1.5 }}>
            <strong style={{ color: "var(--text-hi)" }}>iPhone:</strong> tap Share → Add to Home Screen,
            then open phaTT Picks from the new icon. Required before notifications work on iOS.
            <br />
            <strong style={{ color: "var(--text-hi)" }}>Android / desktop:</strong> use your browser&apos;s
            &ldquo;Install app&rdquo; / &ldquo;Add to Home screen&rdquo; option.
          </p>
        </div>

        {/* Account */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <a href="/help/auth-code" style={{ color: "var(--text-mid)", fontSize: "0.875rem", textDecoration: "none" }}>
            › How Steam sync &amp; the auth code work
          </a>
          <a href="/api/auth/logout" style={{ color: "var(--text-low)", fontSize: "0.875rem", textDecoration: "none" }}>
            › Sign out
          </a>
        </div>
      </div>
      <MobileNav />
    </>
  );
}

/**
 * Signed-out fallback: prior code hard-redirected to /login, which combined with
 * the local-auth dedup bug ([[phatt-picks-m8-3-auth-dedup-state]]) looked like a
 * redirect loop. Show a friendly "session expired" card instead.
 */
function SignedOutProfile() {
  return (
    <>
      <div style={{ padding: "var(--space-4) var(--space-4) calc(72px + env(safe-area-inset-bottom) + var(--space-4))", position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <header style={{ marginBottom: "var(--space-2)" }}>
          <h1 style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: "1.5rem", fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>
            You
          </h1>
        </header>

        <div style={cardStyle}>
          <p style={sectionLabel}>Session expired</p>
          <p style={{ color: "var(--text-mid)", fontSize: "0.875rem", margin: 0, lineHeight: 1.5 }}>
            Sign in again to manage your account and picks.
          </p>
          <a
            href="/api/auth/steam"
            style={{
              textAlign: "center",
              background: "var(--accent)",
              color: "#fff",
              borderRadius: "var(--radius-md)",
              padding: "12px",
              textDecoration: "none",
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 700,
              fontSize: "0.875rem",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            Connect with Steam
          </a>
          <a
            href="/api/auth/local"
            style={{
              textAlign: "center",
              background: "var(--bg2)",
              border: "1px solid var(--bg3)",
              color: "var(--text-mid)",
              borderRadius: "var(--radius-md)",
              padding: "10px",
              textDecoration: "none",
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 600,
              fontSize: "0.875rem",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            Play locally
          </a>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <a href="/help/auth-code" style={{ color: "var(--text-mid)", fontSize: "0.875rem", textDecoration: "none" }}>
            › How Steam sync &amp; the auth code work
          </a>
        </div>
      </div>
      <MobileNav />
    </>
  );
}
