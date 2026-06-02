import Link from "next/link";
import { PushToggle } from "@/components/PushToggle";
import { InviteLink } from "@/components/InviteLink";
import { AvatarUpload } from "@/components/AvatarUpload";
import { AdminLocalPlayers } from "@/components/AdminLocalPlayers";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isOwner } from "@/lib/owner";

/** Profile / settings hub — identity, push opt-in, invite, install, account. */
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) return <SignedOutProfile />;

  const connected = Boolean(session.steamId);
  const initials = session.displayName.slice(0, 2).toUpperCase();
  const owner = isOwner(session);

  // Local players can set a photo; Steam players show their Steam avatar.
  const playerRow = await prisma.player.findUnique({
    where: { id: session.playerId },
    select: { avatarUrl: true },
  });

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">[ PROFILE ]</span>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: "clamp(28px, 5vw, 40px)",
          textTransform: "uppercase",
          lineHeight: 0.95,
        }}>
          You
        </h1>
      </div>

      {/* Identity */}
      <section className="panel brk">
        <span className="br-tr" />
        <span className="br-bl" />
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <AvatarUpload
            initials={initials}
            initialAvatarUrl={playerRow?.avatarUrl ?? null}
            editable={!connected}
          />
          <div style={{ minWidth: 0 }}>
            <p className="font-display" style={{
              fontWeight: 800,
              fontSize: 22,
              color: "var(--ink-hi)",
              textTransform: "uppercase",
              letterSpacing: "0.01em",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {session.displayName}
            </p>
            <p style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: connected ? "var(--heat)" : "var(--ink-mid)",
              margin: "4px 0 0",
            }}>
              {connected ? "Steam-synced player" : "Local player"}
            </p>
          </div>
        </div>
        {!connected && (
          <a href="/api/auth/steam" className="btn-ghost" style={{
            marginTop: 14,
            justifyContent: "center",
            width: "100%",
          }}>
            Connect Steam to sync official picks
          </a>
        )}
      </section>

      {/* Notifications */}
      <section className="panel brk">
        <span className="br-tr" />
        <span className="br-bl" />
        <div className="panel-title">[ Pick-lock reminders ]</div>
        <PushToggle />
      </section>

      {/* Invite */}
      <section className="panel brk">
        <span className="br-tr" />
        <span className="br-bl" />
        <div className="panel-title">[ Invite friends ]</div>
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "0 0 12px" }}>
          Send this link. They land on a one-tap join page — no account hunting.
        </p>
        <InviteLink />
      </section>

      {/* Install */}
      <section className="panel brk">
        <span className="br-tr" />
        <span className="br-bl" />
        <div className="panel-title">[ Install the app ]</div>
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: 0, lineHeight: 1.55 }}>
          <strong style={{ color: "var(--ink-hi)" }}>iPhone:</strong> tap Share → Add to Home Screen, then open HOTLINE from the new icon. Required before notifications work on iOS.
          <br />
          <strong style={{ color: "var(--ink-hi)" }}>Android / desktop:</strong> use your browser&apos;s &ldquo;Install app&rdquo; / &ldquo;Add to Home screen&rdquo; option.
        </p>
      </section>

      {owner && <AdminLocalPlayers />}

      {/* Account links */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
        <Link href="/help/auth-code" style={accountLink}>
          › How Steam sync &amp; the auth code work
        </Link>
        <Link href="/faq" style={accountLink}>
          › FAQ — scoring, Swiss, Viewer Pass
        </Link>
        <Link href="/pwa" style={accountLink}>
          › Install HOTLINE to your home screen
        </Link>
        <Link href="/players" style={accountLink}>
          › Player directory
        </Link>
        <a href="/api/auth/logout" style={{ ...accountLink, color: "var(--ink-low)" }}>
          › Sign out
        </a>
      </section>
    </>
  );
}

const accountLink: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--ink-mid)",
  textDecoration: "none",
};

function SignedOutProfile() {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">[ PROFILE ]</span>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: "clamp(28px, 5vw, 40px)",
          textTransform: "uppercase",
          lineHeight: 0.95,
        }}>
          You
        </h1>
      </div>

      <section className="panel brk">
        <span className="br-tr" />
        <span className="br-bl" />
        <div className="panel-title">[ Session expired ]</div>
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "0 0 16px", lineHeight: 1.55 }}>
          Sign in again to manage your account and picks.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <a href="/api/auth/steam" className="btn-heat" style={{ width: "100%" }}>
            Connect with Steam
          </a>
          <a href="/api/auth/local" className="btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
            Play locally
          </a>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
        <Link href="/help/auth-code" style={accountLink}>
          › How Steam sync &amp; the auth code work
        </Link>
        <Link href="/faq" style={accountLink}>
          › FAQ — scoring, Swiss, Viewer Pass
        </Link>
        <Link href="/pwa" style={accountLink}>
          › Install HOTLINE to your home screen
        </Link>
      </section>
    </>
  );
}
