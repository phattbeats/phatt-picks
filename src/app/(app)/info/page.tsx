/* eslint-disable @next/next/no-img-element -- static editorial photos from /public/wrapped. */

import Link from "next/link";
import { INFO_PHOTOS } from "@/lib/photos";

export const metadata = { title: "Info · HOTLINE" };

/**
 * INFO (#1283) — help & guides get their own home. The links used to be
 * folded into Settings, where most people never opened them; pulled out to a
 * first-class page so "how does this work?" has somewhere obvious to land. On
 * desktop it's a top-nav tab; on mobile it's reached from your profile and the
 * settings page (the bottom nav stays at five tabs — see the ticket note).
 * Singapore skin (prototype 19): a photo grid, the first two guides large.
 */

type Guide = {
  href: string;
  kicker: string;
  title: string;
  blurb: string;
  img: string;
};

const GUIDES: Guide[] = [
  {
    href: "/how-to-play",
    kicker: "Start here",
    title: "How it works",
    blurb: "The whole thing in five minutes — stages, Swiss, scoring and coins.",
    img: INFO_PHOTOS[0],
  },
  {
    href: "/faq",
    kicker: "Quick answers",
    title: "FAQ",
    blurb: "Scoring, Swiss buckets, the Viewer Pass, locks and coins.",
    img: INFO_PHOTOS[1],
  },
  {
    href: "/help/auth-code",
    kicker: "Two minutes",
    title: "Steam sync",
    blurb: "Link your in-game Pick'Em with an auth code.",
    img: INFO_PHOTOS[2],
  },
  {
    href: "/pwa",
    kicker: "For alerts",
    title: "Install HOTLINE",
    blurb: "Put it on your home screen so lock alerts reach you.",
    img: INFO_PHOTOS[3],
  },
  {
    href: "/players",
    kicker: "Directory",
    title: "The room",
    blurb: "Everyone calling this Major — tap through to any profile and their picks.",
    img: INFO_PHOTOS[4],
  },
];

export default function InfoPage() {
  return (
    <div className="sgc-ed">
      <div className="chap-h rise">
        <span className="n">Help &amp; guides</span>
        <h1>
          Everything,
          <br />
          explained
        </h1>
        <p>New to Pick&apos;Em, or just stuck? Pick one.</p>
      </div>

      <section className="sgc-gd rise d1" aria-label="Guides">
        {GUIDES.map((g) => (
          <Link key={g.href} href={g.href} prefetch={false}>
            <img src={g.img} alt="" loading="lazy" />
            <span className="eyebrow">{g.kicker}</span>
            <span className="t">{g.title}</span>
            <p>{g.blurb}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
