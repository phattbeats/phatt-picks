/* eslint-disable @next/next/no-img-element -- static editorial hero photo from /public/wrapped. */

import Link from "next/link";
import { Faq } from "@/components/heat/Faq";
import { PHOTOS } from "@/lib/photos";

export const metadata = { title: "FAQ · HOTLINE" };

/**
 * FAQ (prototype 20). Answers are read off the code: scoring from the layout's
 * points_per_pick (scoring.ts), locks/reveal from reveal-core, the Valve coin
 * gate from coin-core, and the challenge-coin rules from challenge-coin-core.
 */
const CATEGORIES = [
  {
    cat: "Singapore 2026",
    id: "singapore",
    items: [
      {
        q: "When is the Major?",
        a: (
          <>
            <p>
              <b>25 November – 13 December 2026.</b> Three Swiss stages run 25 Nov – 6 Dec, then an
              eight-team bracket at the <b>Singapore Indoor Stadium</b>, 10–13 December.
            </p>
          </>
        ),
      },
      {
        q: "When do picks open?",
        a: (
          <>
            <p>
              <b>When Valve opens Pick&apos;Em for the Major.</b>{" "}HOTLINE mirrors Valve&apos;s Pick&apos;Em,
              so the stages, the teams, Steam sync and the Viewer Pass all arrive together.
            </p>
            <p>Until then the picks page reads &quot;not open&quot;, and the countdown on Home runs to Stage I.</p>
          </>
        ),
      },
      {
        q: "What is the Viewer Pass?",
        a: (
          <>
            <p>
              An in-game CS2 purchase for this Major that unlocks Valve&apos;s official Pick&apos;Em
              Challenge (and its Bronze / Silver / Gold / Diamond coin), team stickers and graffiti, and
              souvenir drops from matches you watch.
            </p>
            <p>
              You only need it to <b>sync with Steam</b>{" "}— playing on HOTLINE itself is free. Valve
              puts it on sale when Pick&apos;Em opens.
            </p>
          </>
        ),
      },
    ],
  },
  {
    cat: "Picks & scoring",
    id: "scoring",
    items: [
      {
        q: "How is it scored?",
        a: (
          <>
            <p>
              Straight from Valve&apos;s Pick&apos;Em weighting. <b>Swiss climbs</b>: each stage has ten
              calls, and every correct call in a stage is worth the same — the 3–0 / advance / 0–3
              bucket doesn&apos;t change the value.
            </p>
            <ul>
              <li>Stage I: <b>1 pt</b> per call → 10 max</li>
              <li>Stage II: <b>2 pts</b> per call → 20 max</li>
              <li>Stage III: <b>3 pts</b> per call → 30 max</li>
            </ul>
            <p>
              <b>Playoffs flip</b> — nailing all four quarterfinals is harder than calling one final.
            </p>
            <ul>
              <li>Quarterfinal winner: <b>12 pts</b> each → 48 max</li>
              <li>Semifinal winner: <b>10 pts</b> each → 20 max</li>
              <li>Grand Final winner: <b>7 pts</b> → 7 max</li>
            </ul>
            <p>
              Perfect Major: <b>135</b> (60 Swiss + 75 playoffs). <Link href="/how-to-play" prefetch={false}>See it explained</Link>.
            </p>
          </>
        ),
      },
      {
        q: "Does the order inside a bucket matter?",
        a: (
          <p>
            No. Slots within a Swiss bucket are interchangeable — put the right team in the right bucket
            and it counts. A 3–0 team placed in Advance is a miss: Advance means <b>3–1 or 3–2</b>.
          </p>
        ),
      },
      {
        q: "When do picks lock?",
        a: (
          <>
            <p>
              At the <b>first match of each stage</b>. Once a stage locks you can&apos;t change those
              picks, and everyone&apos;s calls for it are revealed.
            </p>
            <p>Stages open in order — Stage II&apos;s picks unlock once Stage I&apos;s results are in.</p>
          </>
        ),
      },
      {
        q: "Can I show my picks before the lock?",
        a: (
          <>
            <p>
              Yes. Once every call in a stage is made, you can <b>seal</b> it. Choose <b>Public</b> and
              your calls show on your profile and in head-to-head straight away. Choose <b>Hidden</b>{" "}and
              they stay private until the stage locks, like everyone else&apos;s.
            </p>
            <p>
              Sealed calls can&apos;t be changed. You can switch Hidden to Public later, but Public is
              final, so nobody can sway the room and then backtrack.
            </p>
          </>
        ),
      },
      {
        q: "Can I rank #1 without Steam?",
        a: (
          <p>
            <b>Yes.</b> Local players, synced players, and synced players with a Valve coin all share
            one board, ranked by points. A coinless player at #1 is correct and intentional.
          </p>
        ),
      },
      {
        q: "Can I compare my picks with friends?",
        a: (
          <p>
            Yes. Tap any player on the <Link href="/leaderboard" prefetch={false}>leaderboard</Link> to
            open their profile, then hit <b>Compare with mine</b>{" "}to see both sets side by side for every
            revealed stage, plus any stage they&apos;ve sealed public.
          </p>
        ),
      },
    ],
  },
  {
    cat: "Coins",
    id: "coins",
    items: [
      {
        q: "What are challenge coins?",
        a: (
          <>
            <p>
              HOTLINE&apos;s own collectible: <b>one coin per Major you take part in</b>. Make at least
              one pick and your coin mints when that Major concludes — its Grand Final resolved.
            </p>
            <p>Where you finish on the board decides the metal:</p>
            <ul>
              <li><b>Diamond</b> — the winner, or the top 10%</li>
              <li><b>Gold</b> — top 25%</li>
              <li><b>Silver</b> — top 50%</li>
              <li><b>Bronze</b> — everyone else who took part</li>
            </ul>
            <p>
              Each slice rounds <b>up</b> to whole places, so even a small field strikes every metal —
              in a field of 7, #1 is diamond, #2 gold, #3–4 silver and #5–7 bronze. Any field of two or
              more always has a gold.
            </p>
            <p>
              Coins sit in the felt-lined case on your player profile, you get a notification when one is
              struck, and <Link href="/coins" prefetch={false}>the coin-holders page</Link> lists who holds what for every Major.
            </p>
          </>
        ),
      },
      {
        q: "Is that the same as the Valve coin?",
        a: (
          <p>
            No. The Valve coin is earned in the in-game Pick&apos;Em and only mirrors here for synced
            players. Challenge coins are <b>earned on HOTLINE, by everyone</b> — local or synced.
          </p>
        ),
      },
      {
        q: "Why don't I see a Valve coin on my profile?",
        a: (
          <>
            <p>It only appears with real Valve coin data, which means all three:</p>
            <ul>
              <li>You&apos;re synced with Steam</li>
              <li>You own this Major&apos;s Viewer Pass</li>
              <li>You&apos;ve earned a tier in the in-game Pick&apos;Em</li>
            </ul>
            <p>
              Local players, and synced players without a coin, see none — that&apos;s correct. HOTLINE
              mirrors Valve exactly and never invents a tier.
            </p>
          </>
        ),
      },
    ],
  },
  {
    cat: "Steam & technical",
    id: "technical",
    items: [
      {
        q: "How does Steam sync work?",
        a: (
          <>
            <p>
              You give HOTLINE a <b>Game Authentication Code</b>{" "}from Steam Help, and it reads your
              in-game Pick&apos;Em. You need this Major&apos;s Viewer Pass and to have made picks in the
              in-game Pick&apos;Em, so sync starts once Valve opens Pick&apos;Em.
            </p>
            <p>
              Synced picks mirror your official ones — including stages that already locked.{" "}
              <Link href="/help/auth-code" prefetch={false}>Step-by-step guide</Link>.
            </p>
          </>
        ),
      },
      {
        q: "Can I install it as an app?",
        a: (
          <p>
            <b>Yes.</b> HOTLINE is a Progressive Web App — see the{" "}
            <Link href="/pwa" prefetch={false}>install guide</Link>. On iPhone, lock alerts only work from
            the installed app.
          </p>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="sgc-ed">
      <section className="bleed short">
        <img src={PHOTOS.faqHero} alt="" />
        <span className="credit">Photo · HLTV</span>
        <div className="in">
          <span className="eyebrow rise">Field manual</span>
          <h1 className="display rise d1">FAQ</h1>
          <p className="rise d2">
            Short answers. For the full picture,{" "}
            <Link href="/how-to-play" prefetch={false} className="sgc-link">read how it works</Link>.
          </p>
        </div>
      </section>

      <Faq categories={CATEGORIES} />
    </div>
  );
}
