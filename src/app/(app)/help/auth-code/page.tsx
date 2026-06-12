import { AuthCodeForm } from "@/components/AuthCodeForm";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const metadata = { title: "Connect Steam · HOTLINE" };

const STEAM_AUTH_HELP = "https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730";

const card: React.CSSProperties = {
  position: "relative",
  background: "var(--surf-1)",
  border: "1px solid var(--hair-2)",
  padding: "20px 22px",
};

const mock: React.CSSProperties = {
  background: "var(--surf-2)",
  border: "1px solid var(--hair-2)",
  padding: 14,
  marginTop: 14,
};

function Step({
  n,
  title,
  children,
  illustration,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  illustration: React.ReactNode;
}) {
  return (
    <div className="brk" style={card}>
      <span className="br-tr" />
      <span className="br-bl" />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          background: "var(--heat)",
          color: "var(--void)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 16,
          clipPath: "polygon(0 4px, 4px 0, calc(100% - 4px) 0, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 0 calc(100% - 4px))",
        }}>
          {n}
        </span>
        <h2 className="font-display" style={{
          fontWeight: 800,
          fontSize: 18,
          letterSpacing: "0.01em",
          textTransform: "uppercase",
          color: "var(--ink-hi)",
          margin: 0,
        }}>
          {title}
        </h2>
      </div>
      <div style={{ color: "var(--ink-mid)", fontSize: 14, lineHeight: 1.55, marginTop: 12 }}>
        {children}
      </div>
      {illustration}
    </div>
  );
}

export default async function AuthCodeHelpPage() {
  const session = await getSession();
  const connected = Boolean(session?.steamId);

  let hasAuthCode = false;
  if (connected && session) {
    const p = await prisma.player.findUnique({
      where: { id: session.playerId },
      select: { authCode: true },
    });
    hasAuthCode = Boolean(p?.authCode);
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">[ STEAM_SYNC ]</span>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: "clamp(28px, 5vw, 40px)",
          textTransform: "uppercase",
          lineHeight: 0.95,
        }}>
          Connect your Steam picks
        </h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: "4px 0 0", lineHeight: 1.55 }}>
          Optional. It mirrors your <em style={{ marginRight: "0.15em" }}>official</em> Valve Pick&apos;Em into HOTLINE and lets the app set picks back in-game. Don&apos;t want to? Just play locally — same board, same scoring, no Steam needed.
        </p>
        <p style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-low)",
          margin: "2px 0 0",
        }}>
          Screens below are illustrations of the Steam flow.
        </p>
      </div>

      <Step
        n={1}
        title="Own the Viewer Pass"
        illustration={
          <div style={mock}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--ink-hi)", fontSize: 13, fontWeight: 500 }}>
                IEM Cologne 2026 Viewer Pass
              </span>
              <span style={{
                background: "var(--heat)",
                color: "var(--void)",
                padding: "3px 8px",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.08em",
              }}>
                $9.99
              </span>
            </div>
            <p style={{
              fontFamily: "var(--font-mono)",
              color: "var(--ink-low)",
              fontSize: 10,
              letterSpacing: "0.1em",
              margin: "10px 0 0",
              textTransform: "uppercase",
            }}>
              In CS2 → Premier / Major tab → Viewer Pass
            </p>
          </div>
        }
      >
        The official Pick&apos;Em and its lockable team stickers exist only for Viewer Pass owners. Buy it inside CS2 (about $10). Skip this and you&apos;re a local player — totally fine.
      </Step>

      <Step
        n={2}
        title="Open your Game Authentication Code page"
        illustration={
          <div style={mock}>
            <p style={{
              fontFamily: "var(--font-mono)",
              color: "var(--ink-low)",
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              margin: 0,
            }}>
              help.steampowered.com
            </p>
            <p style={{ color: "var(--ink-mid)", fontSize: 12, margin: "6px 0 0", lineHeight: 1.5 }}>
              Help → <span style={{ color: "var(--ink-hi)" }}>Counter-Strike 2</span> → &ldquo;I want to view, generate, or replace my Game Authentication Code&rdquo;
            </p>
          </div>
        }
      >
        On Steam, go to{" "}
        <a href={STEAM_AUTH_HELP} target="_blank" rel="noopener noreferrer" style={{ color: "var(--heat)" }}>
          Steam Help → Counter-Strike 2
        </a>
        , then choose the Game Authentication Code option. You may be asked to sign in to Steam.
      </Step>

      <Step
        n={3}
        title="Generate & copy the code"
        illustration={
          <div style={{ ...mock, textAlign: "center" }}>
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: 18,
              letterSpacing: "0.2em",
              color: "var(--heat)",
            }}>
              ABCD-12345-WXYZ
            </span>
            <p style={{
              fontFamily: "var(--font-mono)",
              color: "var(--ink-low)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              margin: "10px 0 0",
            }}>
              4 – 5 – 4 characters
            </p>
          </div>
        }
      >
        Steam shows a code shaped <strong style={{ color: "var(--ink-hi)" }}>AAAA-AAAAA-AAAA</strong>. Copy it. It&apos;s a read/write key for <em style={{ marginRight: "0.15em" }}>your</em> picks only — we encrypt it at rest and never show it again.
      </Step>

      <Step
        n={4}
        title="Paste it into HOTLINE"
        illustration={
          connected ? (
            <div style={{ marginTop: 14 }}>
              <AuthCodeForm initiallySet={hasAuthCode} />
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <a href="/api/auth/steam" className="btn-heat" style={{ width: "100%" }}>
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

      <div className="brk" style={{ ...card, background: "var(--surf-2)" }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: 0, lineHeight: 1.55 }}>
          <strong style={{ color: "var(--heat)" }}>On iPhone?</strong> Tap Share → Add to Home Screen, then open HOTLINE from the new icon. That&apos;s the only way iOS will deliver pick-lock reminders.
        </p>
      </div>
    </>
  );
}
