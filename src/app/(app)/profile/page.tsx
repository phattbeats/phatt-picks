import Link from "next/link";
import { PushToggle } from "@/components/PushToggle";
import { NotifPrefsPanel } from "@/components/NotifPrefsPanel";
import { InviteLink } from "@/components/InviteLink";
import { AvatarUpload } from "@/components/AvatarUpload";
import { AdminLocalPlayers } from "@/components/AdminLocalPlayers";
import { LoginTokenPanel } from "@/components/LoginTokenPanel";
import { ClaimLocalPicksPanel } from "@/components/ClaimLocalPicksPanel";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getReferralStats } from "@/lib/invite";
import { isOwner } from "@/lib/owner";
import { parseNotifPrefs } from "@/lib/notifications-core";

/** Profile / settings hub — identity, push opt-in, invite, install, account. */
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) return <SignedOutProfile />;

  const connected = Boolean(session.steamId);
  const initials = session.displayName.slice(0, 2).toUpperCase();
  const owner = isOwner(session);

  const referrals = await getReferralStats(session.playerId);

  // Local players can set a photo; Steam players show their Steam avatar.
  const playerRow = await prisma.player.findUnique({
    where: { id: session.playerId },
    select: { avatarUrl: true, loginToken: true, notifPrefs: true },
  });
  const hasPushSubscription = (await prisma.pushSubscription.count({
    where: { playerId: session.playerId },
  })) > 0;
  const notifPrefs = parseNotifPrefs(playerRow?.notifPrefs);

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">PROFILE</span>
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
          <>
            {/* PHA-1213: a local player has no Steam identity to push to —
                /api/auth/steam would sign them in as a SEPARATE Steam account
                and strand the picks they made here. So Steam sync is shown
                disabled, not as an active CTA. Reassurance lives below. */}
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="btn-ghost"
              title="Steam sync is only available on Steam-linked accounts."
              style={{
                marginTop: 14,
                justifyContent: "center",
                width: "100%",
                opacity: 0.45,
                cursor: "not-allowed",
              }}
            >
              Steam sync — Steam accounts only
            </button>
            <p style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.06em",
              color: "var(--tac-green, #22c55e)",
              margin: "10px 0 0",
            }}>
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Saved — your picks are recorded automatically. No Steam needed.
            </p>
          </>
        )}
      </section>

      {/* Cross-device login — local players only */}
      {!connected && (
        <section className="panel brk">
          <span className="br-tr" />
          <span className="br-bl" />
          <div className="panel-title">[ Login from another device ]</div>
          <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "0 0 12px", lineHeight: 1.55 }}>
            Copy this link and open it on any browser to sign in as you — no password needed.
          </p>
          <LoginTokenPanel initialToken={playerRow?.loginToken ?? null} />
        </section>
      )}

      {/* Bring over guest picks — Steam players only (PHA-1232). The Steam
          callback never merges a pre-existing guest account, so picks made
          before signing in with Steam would otherwise be stranded. */}
      {connected && (
        <section className="panel brk">
          <span className="br-tr" />
          <span className="br-bl" />
          <div className="panel-title">[ Bring over guest picks ]</div>
          <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "0 0 12px", lineHeight: 1.55 }}>
            Made picks as a guest before signing in with Steam? Paste that guest
            login link to move those picks onto this Steam account. Picks already
            set here are kept.
          </p>
          <ClaimLocalPicksPanel />
        </section>
      )}

      {/* Notifications */}
      <section className="panel brk">
        <span className="br-tr" />
        <span className="br-bl" />
        <div className="panel-title">Notifications</div>
        <NotifPrefsPanel
          initialPrefs={notifPrefs}
          hasPushSubscription={hasPushSubscription}
        />
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--hair)" }}>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--heat)",
            marginBottom: 10,
          }}>
            Push reminders
          </div>
          <PushToggle />
        </div>
      </section>

      {/* Invite */}
      <section className="panel brk">
        <span className="br-tr" />
        <span className="br-bl" />
        <div className="panel-title">Invite friends</div>
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "0 0 12px" }}>
          Send this link. They land on a one-tap join page — no account hunting.
        </p>
        <InviteLink />

        {(referrals.count > 0 || referrals.invitedByName) && (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--hair)",
            }}
          >
            <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="foil font-display" style={{ fontWeight: 800, fontSize: 22, lineHeight: 1 }}>
                {referrals.count}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-low)" }}>
                {referrals.count === 1 ? "player joined" : "players joined"} through you
              </span>
            </span>
            {referrals.invitedByName && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-low)", textAlign: "right", minWidth: 0 }}>
                Invited by{" "}
                <span style={{ color: "var(--ink-mid)" }}>{referrals.invitedByName}</span>
              </span>
            )}
          </div>
        )}
      </section>

      {/* Install */}
      <section className="panel brk">
        <span className="br-tr" />
        <span className="br-bl" />
        <div className="panel-title">Install the app</div>
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: 0, lineHeight: 1.55 }}>
          <strong style={{ color: "var(--ink-hi)" }}>iPhone:</strong> tap Share → Add to Home Screen, then open HOTLINE from the new icon. Required before notifications work on iOS.
          <br />
          <strong style={{ color: "var(--ink-hi)" }}>Android / desktop:</strong> use your browser&apos;s &ldquo;Install app&rdquo; / &ldquo;Add to Home screen&rdquo; option.
        </p>
      </section>

      {owner && <AdminLocalPlayers />}

      {/* Account links */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
        <Link href="/how-to-play" style={accountLink}>
          › New to Pick&apos;Em? How it works
        </Link>
        <Link href="/majors" style={accountLink}>
          › Your Majors — your picks &amp; score every event
        </Link>
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
        {/* POST so a cross-site GET can't force a logout (PHA-1045 CSRF). */}
        <form action="/api/auth/logout" method="post" style={{ margin: 0 }}>
          <button
            type="submit"
            style={{
              ...accountLink,
              color: "var(--ink-low)",
              background: "none",
              border: "none",
              padding: 0,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            › Sign out
          </button>
        </form>
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
        <span className="eyebrow-mono">PROFILE</span>
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
        <div className="panel-title">Session expired</div>
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
        <Link href="/how-to-play" style={accountLink}>
          › New to Pick&apos;Em? How it works
        </Link>
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
