import { MobileNav } from "@/components/ui/MobileNav";
import { AuthCodeForm } from "@/components/AuthCodeForm";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const metadata = { title: "Connect Steam · phaTT Picks" };

const STEAM_AUTH_HELP = "https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730";

const card: React.CSSProperties = {
  background: "var(--bg1)",
  border: "1px solid var(--bg3)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-4)",
};

const mock: React.CSSProperties = {
  background: "var(--bg2)",
  border: "1px solid var(--bg3)",
  borderRadius: "var(--radius-md)",
  padding: "var(--space-3)",
  marginTop: "var(--space-3)",
};

function Step({ n, title, children, illustration }: { n: number; title: string; children: React.ReactNode; illustration: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: "50%",
            background: "var(--accent)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 700,
            fontSize: "0.875rem",
          }}
        >
          {n}
        </span>
        <h2 style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: "1.0625rem", fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>
          {title}
        </h2>
      </div>
      <div style={{ color: "var(--text-mid)", fontSize: "0.875rem", lineHeight: 1.55, marginTop: "var(--space-2)" }}>{children}</div>
      {illustration}
    </div>
  );
}

/** Auth-code how-to (handoff §8.5 onboarding deliverable), session-aware. */
export default async function AuthCodeHelpPage() {
  const session = await getSession();
  const connected = Boolean(session?.steamId);

  let hasAuthCode = false;
  if (connected && session) {
    const p = await prisma.player.findUnique({ where: { id: session.playerId }, select: { authCode: true } });
    hasAuthCode = Boolean(p?.authCode);
  }

  return (
    <>
      <div className="with-nav" style={{ padding: "var(--space-4)", position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <header>
          <h1 style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: "1.5rem", fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>
            Connect your Steam picks
          </h1>
          <p style={{ color: "var(--text-mid)", fontSize: "0.9375rem", margin: "var(--space-2) 0 0", lineHeight: 1.5 }}>
            Optional. It mirrors your <em>official</em> Valve Pick&apos;Em into phaTT Picks and lets the
            app set picks back in-game. Don&apos;t want to? Just play locally — same board, same scoring,
            no Steam needed.
          </p>
          <p style={{ color: "var(--text-low)", fontSize: "0.75rem", margin: "var(--space-2) 0 0" }}>
            Screens below are illustrations of the Steam flow.
          </p>
        </header>

        <Step
          n={1}
          title="Own the Viewer Pass"
          illustration={
            <div style={mock}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-hi)", fontSize: "0.8125rem", fontWeight: 600 }}>IEM Cologne 2026 Viewer Pass</span>
                <span style={{ background: "var(--correct)", color: "#0a0a0b", borderRadius: "var(--radius-sm)", padding: "2px 8px", fontSize: "0.75rem", fontWeight: 700 }}>
                  $9.99
                </span>
              </div>
              <p style={{ color: "var(--text-low)", fontSize: "0.6875rem", margin: "var(--space-2) 0 0" }}>In CS2 → Premier / Major tab → Viewer Pass</p>
            </div>
          }
        >
          The official Pick&apos;Em and its lockable team stickers exist only for Viewer Pass owners.
          Buy it inside CS2 (about $10). Skip this and you&apos;re a local player — totally fine.
        </Step>

        <Step
          n={2}
          title="Open your Game Authentication Code page"
          illustration={
            <div style={mock}>
              <p style={{ color: "var(--text-low)", fontSize: "0.6875rem", margin: 0 }}>help.steampowered.com</p>
              <p style={{ color: "var(--text-mid)", fontSize: "0.75rem", margin: "var(--space-1) 0 0" }}>
                Help → <span style={{ color: "var(--text-hi)" }}>Counter-Strike 2</span> → &ldquo;I want to view, generate, or replace my Game Authentication Code&rdquo;
              </p>
            </div>
          }
        >
          On Steam, go to{" "}
          <a href={STEAM_AUTH_HELP} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            Steam Help → Counter-Strike 2
          </a>
          , then choose the Game Authentication Code option. You may be asked to sign in to Steam.
        </Step>

        <Step
          n={3}
          title="Generate &amp; copy the code"
          illustration={
            <div style={{ ...mock, textAlign: "center" }}>
              <span style={{ fontFamily: "monospace", fontSize: "1.125rem", letterSpacing: "0.15em", color: "var(--text-hi)" }}>ABCD-12345-WXYZ</span>
              <p style={{ color: "var(--text-low)", fontSize: "0.6875rem", margin: "var(--space-2) 0 0" }}>4 – 5 – 4 characters</p>
            </div>
          }
        >
          Steam shows a code shaped <strong style={{ color: "var(--text-hi)" }}>AAAA-AAAAA-AAAA</strong>. Copy
          it. It&apos;s a read/write key for <em>your</em> picks only — we encrypt it at rest and never show it again.
        </Step>

        <Step
          n={4}
          title="Paste it into phaTT Picks"
          illustration={
            connected ? (
              <div style={{ marginTop: "var(--space-3)" }}>
                <AuthCodeForm initiallySet={hasAuthCode} />
              </div>
            ) : (
              <div style={{ marginTop: "var(--space-3)" }}>
                <a
                  href="/api/auth/steam"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--accent)",
                    color: "#fff",
                    borderRadius: "var(--radius-md)",
                    padding: "12px",
                    textDecoration: "none",
                    fontFamily: "'Rajdhani', sans-serif",
                    fontWeight: 700,
                    fontSize: "0.9375rem",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    minHeight: 44,
                  }}
                >
                  Sign in with Steam to paste your code
                </a>
              </div>
            )
          }
        >
          {connected
            ? "Drop the code below. We'll mirror your official picks within a few minutes."
            : "Sign in with Steam first (local players don't need a code). Then come back here to paste it."}
        </Step>

        <div style={{ ...card, background: "var(--bg2)" }}>
          <p style={{ color: "var(--text-mid)", fontSize: "0.8125rem", margin: 0, lineHeight: 1.5 }}>
            <strong style={{ color: "var(--text-hi)" }}>On iPhone?</strong> Tap Share → Add to Home Screen,
            then open phaTT Picks from the new icon. That&apos;s the only way iOS will deliver pick-lock reminders.
          </p>
        </div>
      </div>
      <MobileNav />
    </>
  );
}
