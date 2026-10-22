import Link from "next/link";
import { PushToggle } from "@/components/PushToggle";
import { NotifPrefsPanel } from "@/components/NotifPrefsPanel";
import { InviteLink } from "@/components/InviteLink";
import { AvatarUpload } from "@/components/AvatarUpload";
import { AdminLocalPlayers } from "@/components/AdminLocalPlayers";
import { LoginTokenPanel } from "@/components/LoginTokenPanel";
import { ClaimLocalPicksPanel } from "@/components/ClaimLocalPicksPanel";
import { TipsSettingRow } from "@/components/coach/TipsSettingRow";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getReferralStats } from "@/lib/invite";
import { isOwner } from "@/lib/owner";
import { parseNotifPrefs } from "@/lib/notifications-core";

/**
 * Settings — every account control, reached by the gear cog on your profile
 * (#1275). The profile itself (/players/{you}) stays a clean stat card; this
 * page owns identity, notifications, invites, devices, and the help links that
 * most people never open — collapsed into disclosures so the page opens calm.
 */
export default async function SettingsPage() {
  const session = await getSession();
  if (!session) return <SignedOutSettings />;

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
    <div className="sg-page nf-set">
      <div className="chap-h rise">
        <span className="n">
          <Link href={`/players/${session.playerId}`} prefetch={false} className="nf-back">
            ← Profile
          </Link>
        </span>
        <h1 className="nf-title">Settings</h1>
      </div>

      {/* Identity */}
      <section className="who rise d1">
        <AvatarUpload
          initials={initials}
          initialAvatarUrl={playerRow?.avatarUrl ?? null}
          editable={!connected}
        />
        <div className="who-id">
          <span className="nm">{session.displayName}</span>
          {connected ? <span className="tag ok">Steam-synced</span> : <span className="tag">Local player</span>}
          {!connected && (
            <span className="nf-ok">
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Saved — your picks are recorded automatically. No Steam needed.
            </span>
          )}
        </div>
        {!connected && (
          // #1213: a local player has no Steam identity to push to —
          // /api/auth/steam would sign them in as a SEPARATE Steam account and
          // strand the picks they made here. So Steam sync is shown disabled,
          // not as an active CTA.
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="btn-ghost nf-btn-sm who-steam"
            title="Steam sync is only available on Steam-linked accounts."
          >
            Steam sync — Steam accounts only
          </button>
        )}
      </section>

      <div className="lay rise d2">
        <nav className="toc" aria-label="Settings sections">
          <a href="#alerts">Alerts</a>
          <a href="#invite">Invite</a>
          <a href="#account">Account &amp; devices</a>
          <a href="#session">Session</a>
          {owner && <a href="#admin">Admin</a>}
        </nav>

        <div className="secs">
          {/* Alerts */}
          <section className="sec" id="alerts">
            <div className="chap-h">
              <h2>When to ping you</h2>
              <p>Choose what lands in your feed and what reaches this device as a push.</p>
            </div>
            <NotifPrefsPanel initialPrefs={notifPrefs} hasPushSubscription={hasPushSubscription} />
            <div className="sec-sub">
              <span className="eyebrow">This device</span>
              <PushToggle />
            </div>
          </section>

          {/* Invite */}
          <section className="sec" id="invite">
            <div className="chap-h">
              <h2>Bring the group</h2>
              <p>
                Friends land on a one-tap join page — no account hunting.
                {referrals.count > 0 && (
                  <>
                    {" "}
                    <b>
                      {referrals.count} {referrals.count === 1 ? "player has" : "players have"}
                    </b>{" "}
                    joined through you.
                  </>
                )}
              </p>
            </div>
            <InviteLink />
            {referrals.invitedByName && (
              <p className="nf-meta">
                Invited by <b>{referrals.invitedByName}</b>
              </p>
            )}
          </section>

          {/* Account & devices — second-tier controls, folded away so the page
              opens calm. Cross-device login / claim guest picks / install. */}
          <section className="sec" id="account">
            <details className="settings-fold">
              <summary>
                <span className="settings-fold-t">Account &amp; devices</span>
                <span className="settings-fold-hint">
                  Login link · install · {connected ? "guest picks" : "another device"}
                </span>
              </summary>
              <div className="settings-fold-body">
                {/* Cross-device login — local players only */}
                {!connected && (
                  <div className="fold-item">
                    <div className="t">Sign in on another device</div>
                    <div className="s">
                      Open this link in any browser to sign in as you — no password needed.
                    </div>
                    <LoginTokenPanel initialToken={playerRow?.loginToken ?? null} />
                  </div>
                )}

                {/* Bring over guest picks — Steam players only (#1232). */}
                {connected && (
                  <div className="fold-item">
                    <div className="t">Bring guest picks over</div>
                    <div className="s">
                      Made picks as a guest before signing in with Steam? Paste that guest login link to
                      move them onto this account. Picks already set here are kept.
                    </div>
                    <ClaimLocalPicksPanel />
                  </div>
                )}

                {/* Install */}
                <div className="fold-item">
                  <div className="row fold-row">
                    <div>
                      <div className="t">Install to home screen</div>
                      <div className="s">Required for alerts on iPhone.</div>
                    </div>
                    <Link href="/pwa" prefetch={false} className="btn-ghost nf-btn-sm">
                      Install
                    </Link>
                  </div>
                  <p className="s">
                    <b>iPhone:</b> tap Share → Add to Home Screen, then open HOTLINE from the new icon.{" "}
                    <b>Android / desktop:</b>{" "}use your browser&apos;s &ldquo;Install app&rdquo; option.
                  </p>
                </div>
              </div>
            </details>
          </section>

          {/* Session — help link + sign out, always one tap away. */}
          <section className="sec" id="session">
            <div className="chap-h">
              <h2>Session</h2>
            </div>
            <div className="list">
              {/* Coach-mark tips (blue bubbles): on/off + reset. */}
              <TipsSettingRow />
              {/* Help & guides live on their own INFO page (#1283). */}
              <div className="row">
                <div>
                  <div className="t">Help &amp; guides</div>
                  <div className="s">How it works · FAQ · scoring</div>
                </div>
                <Link href="/info" prefetch={false} className="btn-ghost nf-btn-sm">
                  Open
                </Link>
              </div>
              <div className="row">
                <div>
                  <div className="t">Sign out</div>
                  <div className="s">Picks stay saved to your account</div>
                </div>
                {/* POST so a cross-site GET can't force a logout (#1045 CSRF). */}
                <form action="/api/auth/logout" method="post">
                  <button type="submit" className="btn-ghost nf-btn-sm nf-danger">
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </section>

          {owner && <AdminLocalPlayers />}
        </div>
      </div>
    </div>
  );
}

function SignedOutSettings() {
  return (
    <div className="sg-page nf-set">
      <div className="chap-h rise">
        <span className="n">Settings</span>
        <h1 className="nf-title">Sign in</h1>
        <p>Your session has ended. Sign in again to manage your alerts, invites and picks.</p>
      </div>

      <section className="nf-signin rise d1">
        <a href="/api/auth/steam" className="btn-solid">
          Connect with Steam
        </a>
        <a href="/api/auth/local" className="btn-ghost">
          Play locally
        </a>
      </section>

      <div className="list rise d2">
        <div className="row">
          <div>
            <div className="t">Help &amp; guides</div>
            <div className="s">How it works · FAQ</div>
          </div>
          <Link href="/info" prefetch={false} className="btn-ghost nf-btn-sm">
            Open
          </Link>
        </div>
      </div>
    </div>
  );
}
