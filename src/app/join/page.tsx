/* eslint-disable @next/next/no-img-element -- full-bleed background photo; next/image adds nothing here. */
import Link from "next/link";
import { HotlineLockup } from "@/components/heat/HeatMark";
import { PHOTOS } from "@/lib/photos";
import { phattIdConfig } from "@/lib/phatt-id";

export const metadata = { title: "Join HOTLINE for Singapore" };

/**
 * Public "how do I get in" page — the link the phattmedia.club post points at.
 * Sign in, (optionally) Viewer Pass, paste the Game Authentication Code, and
 * what syncs. Invite landings live under /join/<code>.
 */
export default function JoinHotlinePage() {
  const phattId = phattIdConfig() !== null;
  return (
    <div className="full sg-auth sg-join" data-screen-label="Join HOTLINE">
      <div className="bgp">
        <img src={PHOTOS.joinHero} alt="" />
      </div>
      <div className="top rise">
        <Link href="/login?intro=return" prefetch={false} className="brand" aria-label="HOTLINE sign-in">
          <HotlineLockup height={28} />
        </Link>
      </div>
      <div className="body">
        <h1 className="display h1 rise d1">Join HOTLINE for Singapore</h1>
        <p className="lede rise d2">
          Four steps. Only the first is required. Everything else just links HOTLINE to your official in-game
          Pick&apos;Em.
        </p>
        <ol className="lede rise d3">
          <li>
            <b>Sign in.</b> {phattId ? "Use your PHATT ID or Steam, or " : "Use Steam, or "}play locally with no
            account. Local mode is fully featured; it just doesn&apos;t talk to Valve.
          </li>
          <li>
            <b>Get the Singapore Viewer Pass</b> (in CS2, about $10) for the official in-game Pick&apos;Em. Valve only
            opens it to Viewer Pass owners, and only once the Major&apos;s Pick&apos;Em is open.
          </li>
          <li>
            <b>Paste your Game Authentication Code</b> from Steam Help. Steam sign-in first, then{" "}
            <Link href="/help/auth-code" prefetch={false}>
              follow the two-minute guide
            </Link>
            . If you saved a code for an earlier Major, HOTLINE tries it first when Pick&apos;Em opens and only asks for a
            new one if Valve refuses it. You do not need a Steam Web API key.
          </li>
          <li>
            <b>Pick and track.</b> Your official picks appear in HOTLINE within a few minutes, and picks you make in
            HOTLINE are set back in-game while the stage is open. Your progress follows you through every stage.
          </li>
        </ol>
        <div className="acts rise d4">
          {phattId && (
            <a href="/api/auth/authentik" className="btn-solid">
              Sign in with PHATT ID
            </a>
          )}
          <a href="/api/auth/steam" className={phattId ? "btn-ghost" : "btn-solid"}>
            Sign in with Steam
          </a>
          <Link href="/login/local" prefetch={false} className="btn-ghost">
            Play locally
          </Link>
        </div>
      </div>
    </div>
  );
}
