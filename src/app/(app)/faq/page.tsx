import Link from "next/link";
import { Faq } from "@/components/heat/Faq";

export const metadata = { title: "FAQ · HOTLINE" };

const CATEGORIES = [
  {
    cat: "IEM Cologne 2026",
    items: [
      {
        q: "When is IEM Cologne 2026?",
        a: (
          <>
            <p><strong>June 2–21, 2026</strong> in Cologne, Germany.</p>
            <p>The tournament runs for 20 days, covering three Swiss stages and an 8-team playoff bracket.</p>
          </>
        ),
      },
      {
        q: "What is the Viewer Pass?",
        a: (
          <>
            <p>The <strong>IEM Cologne 2026 Viewer Pass</strong> is a ~$10 in-game purchase that unlocks:</p>
            <ul>
              <li>The official Valve Pick&apos;Em Challenge (earn Bronze/Silver/Gold/Diamond coin)</li>
              <li>Team stickers and graffiti</li>
              <li>Souvenir drops from matches you watch</li>
            </ul>
            <p>If you want HOTLINE to mirror your Valve coin tier, you need to own this Major&apos;s Viewer Pass and complete picks in-game.</p>
          </>
        ),
      },
    ],
  },
  {
    cat: "Steam Sync & Coins",
    items: [
      {
        q: "How does Steam sync work?",
        a: (
          <>
            <p>When you connect your Steam account, HOTLINE uses a <strong>Game Authentication Code</strong> (from Steam Help) to read your in-game Pick&apos;Em data.</p>
            <p><strong>Prerequisites:</strong></p>
            <ul>
              <li>You own this Major&apos;s Viewer Pass in CS2</li>
              <li>You&apos;ve made picks in the in-game Pick&apos;Em</li>
            </ul>
            <p>HOTLINE then mirrors your Valve coin tier on your profile and board. The coin only appears if you actually earned it in-game. <Link href="/help/auth-code">Step-by-step guide →</Link></p>
          </>
        ),
      },
      {
        q: "Why don't I see a coin on my profile?",
        a: (
          <>
            <p>Coins only show when you have <strong>real Valve coin data</strong>. This means:</p>
            <ul>
              <li>You&apos;re synced with Steam</li>
              <li>You own this Major&apos;s Viewer Pass</li>
              <li>You&apos;ve earned a tier (Bronze/Silver/Gold/Diamond) in the in-game Pick&apos;Em</li>
            </ul>
            <p><strong>Local players</strong> and <strong>synced players without a coin</strong> both see no coin — this is correct. The coin mirrors Valve exactly; we don&apos;t invent app-specific tiers.</p>
          </>
        ),
      },
      {
        q: "Can I still rank #1 without a coin?",
        a: (
          <>
            <p><strong>Yes.</strong> The board ranks everyone by in-app points — local players, synced players, and synced players with coins all compete on the same board.</p>
            <p>The coin is a Valve-mirrored badge, not a leaderboard tier. A coinless player at #1 is correct and intentional.</p>
          </>
        ),
      },
    ],
  },
  {
    cat: "Picks & Scoring",
    items: [
      {
        q: "How is scoring calculated?",
        a: (
          <>
            <p>Points come straight from Valve&apos;s Pick&apos;Em — the same weighting every CS2 Major ships with. It&apos;s surprising in two ways: Swiss escalates, and playoffs invert. Both are intentional.</p>
            <p><strong>Swiss escalates (later stages worth more).</strong> Each stage has 10 picks. Within a stage, <strong>every correct pick is worth the same flat value</strong> — the 3-0 / 0-3 / advance distinction does <em>not</em> change points.</p>
            <ul>
              <li>Stage 1: <strong>1 pt</strong> per pick → <strong>10 max</strong></li>
              <li>Stage 2: <strong>2 pts</strong> per pick → <strong>20 max</strong></li>
              <li>Stage 3: <strong>3 pts</strong> per pick → <strong>30 max</strong></li>
              <li>Swiss total: <strong>60 pts</strong></li>
            </ul>
            <p><strong>Playoffs invert (earlier rounds worth more).</strong> Nailing all four quarterfinals is much harder than calling one Grand Final.</p>
            <ul>
              <li>Quarterfinal winner: <strong>12 pts</strong> each → <strong>48 max</strong></li>
              <li>Semifinal winner: <strong>10 pts</strong> each → <strong>20 max</strong></li>
              <li>Grand Final winner: <strong>7 pts</strong> → <strong>7 max</strong></li>
              <li>Playoffs total: <strong>75 pts</strong></li>
            </ul>
            <p><strong>Perfect tournament: 135 points</strong> (60 Swiss + 75 Playoffs). This mirrors the in-game Pick&apos;Em coin exactly.</p>
          </>
        ),
      },
      {
        q: "When do picks lock?",
        a: (
          <>
            <p>Each stage locks right before it starts. Once a stage locks you can&apos;t change those picks, and results are revealed as matches finish.</p>
            <p>Stages open in order — Stage 2&apos;s picks unlock once Stage 1&apos;s results are in.</p>
          </>
        ),
      },
      {
        q: "Can I compare my picks with friends?",
        a: (
          <p>Yes. Tap any player on the <Link href="/leaderboard">leaderboard</Link> to open their profile, then hit <strong>Compare with mine</strong>. You&apos;ll see your picks side-by-side with theirs for every revealed stage.</p>
        ),
      },
    ],
  },
  {
    cat: "Technical",
    items: [
      {
        q: "Can I install this as an app?",
        a: (
          <>
            <p><strong>Yes.</strong> HOTLINE is a Progressive Web App (PWA). Install it for faster access and live pick-lock notifications.</p>
            <ul>
              <li><strong>Android/Desktop:</strong> tap the install prompt, or &ldquo;Install&rdquo; in your browser menu.</li>
              <li><strong>iOS:</strong> tap Share → &ldquo;Add to Home Screen&rdquo; in Safari.</li>
            </ul>
            <p>See the <Link href="/pwa">install guide</Link> for step-by-step instructions.</p>
          </>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="eyebrow-mono">FIELD MANUAL</span>
        <h1 className="font-display" style={{
          fontWeight: 900,
          fontSize: "clamp(34px, 7vw, 52px)",
          textTransform: "uppercase",
          lineHeight: 0.92,
          letterSpacing: "-0.01em",
        }}>
          FAQ
        </h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: "2px 0 0" }}>
          Scoring, Swiss structure, the Viewer Pass, and how Steam sync works.
        </p>
      </div>

      <Faq categories={CATEGORIES} />
    </>
  );
}
