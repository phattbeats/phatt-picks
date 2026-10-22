import Link from "next/link";
import { AuthCodeForm } from "@/components/AuthCodeForm";
import { getSession } from "@/lib/session";
import { currentEvent } from "@/lib/events-core";
import { eventShortName } from "@/lib/leaderboard";
import { authCodeStatus, savedForLabel } from "@/lib/authcode";
import { isPickemOpen } from "@/lib/layout-state";

export const metadata = { title: "Connect Steam · HOTLINE" };

const STEAM_AUTH_HELP = "https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730";

export default async function AuthCodeHelpPage() {
  const session = await getSession();
  const connected = Boolean(session?.steamId);
  const event = currentEvent();
  const open = await isPickemOpen(event.eventId);
  const majorName = eventShortName(event);

  const code = connected && session ? await authCodeStatus(session.playerId, event.eventId) : null;

  return (
    <div className="sg-page sg-authcode" data-screen-label="Auth Code Setup">
      <div className="chap-h rise">
        <span className="n">
          <Link href="/settings" prefetch={false}>
            ← Settings
          </Link>{" "}
          · Steam sync · ~2 min
        </span>
        <h1>
          Link your
          <br />
          in-game picks
        </h1>
        <p>
          One code mirrors your official Valve Pick&apos;Em into HOTLINE and lets the app{" "}
          <b>set picks back in-game</b>. Steam may give you a new code for each Major, so add this Major&apos;s code
          when Pick&apos;Em opens.
        </p>
      </div>

      <div className="lay">
        <div className="main">
          <div className="pre rise d1">
            <span className="tag warn">Before you start</span>
            <p>
              Own the <b>Singapore Viewer Pass</b>{" "}(in CS2, about $10) and open the Pick&apos;Em in-game once. The
              official Pick&apos;Em exists only for Viewer Pass owners — without it, the code won&apos;t work.
            </p>
            {!open && (
              <p>
                <b>Not open yet.</b>{" "}Valve hasn&apos;t opened Pick&apos;Em for this Major, so the Viewer Pass and
                the in-game Pick&apos;Em aren&apos;t available. You can save your code now. Sync starts when it opens.
              </p>
            )}
          </div>

          <div className="steps rise d2">
            <div>
              <span className="n">1</span>
              <div>
                <div className="t">Open Steam Help</div>
                <p>Go to Steam Help for Counter-Strike 2. You may be asked to sign in to Steam.</p>
                <a className="btn-ghost step-cta" href={STEAM_AUTH_HELP} target="_blank" rel="noopener noreferrer">
                  Open Steam Help ↗
                </a>
              </div>
            </div>
            <div>
              <span className="n">2</span>
              <div>
                <div className="t">Pick the code option</div>
                <p>Choose the Game Authentication Code option.</p>
                <div className="shot">
                  <span className="k">help.steampowered.com</span>
                  <span>
                    Help → <b>Counter-Strike 2</b>{" "}→ &ldquo;I want to view, generate, or replace my Game Authentication
                    Code&rdquo;
                  </span>
                </div>
              </div>
            </div>
            <div>
              <span className="n">3</span>
              <div>
                <div className="t">Generate &amp; copy</div>
                <p>
                  Steam shows a code shaped like <b className="mono">XXXX-XXXXX-XXXX</b>. Copy it — it&apos;s a
                  read/write key for <em>your</em> picks only.
                </p>
              </div>
            </div>
            <div>
              <span className="n">4</span>
              <div>
                <div className="t">Paste it into HOTLINE</div>
                <p>
                  {connected
                    ? "Drop the code in the panel. We'll mirror your official picks within a few minutes."
                    : "Sign in with Steam first (local players don't need a code), then come back here to paste it."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <aside className="side rise d3">
          {connected ? (
            <AuthCodeForm
              initialStatus={code?.status ?? "none"}
              majorName={majorName}
              staleFor={code?.status === "stale" ? savedForLabel(code.savedForEventId) : null}
            />
          ) : (
            <a href="/api/auth/steam" className="btn-solid">
              Sign in with Steam to paste your code
            </a>
          )}
          <Link href="/" prefetch={false} className="btn-ghost">
            I&apos;ll do this later
          </Link>
          <div className="why">
            <span>
              <b>Private.</b> Encrypted at rest, never shown again, only used to sync your picks with Valve.
            </span>
            <span>
              <b>Revocable.</b> Regenerate it on Steam any time to cut access.
            </span>
            <span>
              <b>On iPhone?</b> Share → Add to Home Screen, then open HOTLINE from the new icon — the only way iOS
              delivers pick-lock reminders.
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
