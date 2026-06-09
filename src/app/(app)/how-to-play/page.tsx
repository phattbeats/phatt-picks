import Link from "next/link";

export const metadata = { title: "How Pick'Em works · HOTLINE" };

/**
 * The newcomer field manual (PHA-987). HOTLINE is being shared with friends and
 * coworkers who have never seen a Pick'Em and aren't CS2 / esports regulars. The
 * FAQ answers questions you already know to ask; this page answers the one you
 * don't: "what is this and what do I actually do?" Plain language, zero jargon
 * that isn't immediately unpacked, ordered the way a first-timer meets the app.
 */

const card: React.CSSProperties = {
  position: "relative",
  background: "var(--surf-1)",
  border: "1px solid var(--hair-2)",
  padding: "20px 22px",
};

const lead: React.CSSProperties = {
  color: "var(--ink-mid)",
  fontSize: 14,
  lineHeight: 1.6,
};

function SectionTitle({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <span className="eyebrow-mono">{kicker}</span>
      <h2 className="font-display" style={{
        fontWeight: 800,
        fontSize: "clamp(20px, 4.5vw, 26px)",
        textTransform: "uppercase",
        letterSpacing: "0.01em",
        lineHeight: 1,
        color: "var(--ink-hi)",
        margin: 0,
      }}>
        {children}
      </h2>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
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
        <h3 className="font-display" style={{
          fontWeight: 800,
          fontSize: 17,
          letterSpacing: "0.01em",
          textTransform: "uppercase",
          color: "var(--ink-hi)",
          margin: 0,
        }}>
          {title}
        </h3>
      </div>
      <div style={{ color: "var(--ink-mid)", fontSize: 14, lineHeight: 1.55, marginTop: 12 }}>
        {children}
      </div>
    </div>
  );
}

/** One of the three calls you make in a Swiss stage. */
function Bucket({ tag, color, label, blurb }: { tag: string; color: string; label: string; blurb: string }) {
  return (
    <div style={{
      flex: "1 1 0",
      minWidth: 0,
      background: "var(--surf-2)",
      border: "1px solid var(--hair-2)",
      borderTop: `3px solid ${color}`,
      padding: "14px 14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: "0.04em",
        color,
      }}>
        {tag}
      </span>
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--ink-hi)",
        fontWeight: 600,
      }}>
        {label}
      </span>
      <span style={{ color: "var(--ink-mid)", fontSize: 12.5, lineHeight: 1.5 }}>{blurb}</span>
    </div>
  );
}

export default function HowToPlayPage() {
  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">[ NEW_RECRUIT ]</span>
        <h1 className="font-display" style={{
          fontWeight: 900,
          fontSize: "clamp(32px, 7vw, 50px)",
          textTransform: "uppercase",
          lineHeight: 0.92,
          letterSpacing: "-0.01em",
        }}>
          How Pick&apos;Em works
        </h1>
        <p style={{ ...lead, margin: "4px 0 0" }}>
          Never done this before? You&apos;re in the right place. No CS2 deep-lore required —
          read this once and you&apos;ll know exactly what to do.
        </p>
      </div>

      {/* What even is this */}
      <SectionTitle kicker="[ THE IDEA ]">The whole thing in one line</SectionTitle>
      <div className="brk" style={{ ...card, borderLeft: "3px solid var(--heat)" }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <p style={{ ...lead, margin: 0, fontSize: 15 }}>
          A <strong style={{ color: "var(--ink-hi)" }}>Pick&apos;Em</strong> is calling how a tournament
          plays out <em>before it&apos;s played</em>. You predict which teams win and which go home.
          Get it right, score points, climb the board against everyone else who played.
          That&apos;s the game.
        </p>
      </div>

      {/* The shape of a Major */}
      <SectionTitle kicker="[ THE EVENT ]">What you&apos;re predicting</SectionTitle>
      <div className="brk" style={card}>
        <span className="br-tr" />
        <span className="br-bl" />
        <p style={{ ...lead, margin: 0 }}>
          <strong style={{ color: "var(--ink-hi)" }}>IEM Cologne 2026</strong> is a Counter-Strike Major —
          one of the biggest events in the sport. The teams fight through it in two phases:
        </p>
        <ul style={{ ...lead, margin: "12px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>
            <strong style={{ color: "var(--ink-hi)" }}>Three Swiss stages.</strong> Teams play until they
            rack up enough wins to move on — or enough losses to be knocked out. You make a fresh set of
            picks for each stage.
          </li>
          <li>
            <strong style={{ color: "var(--ink-hi)" }}>An 8-team playoff bracket.</strong> The survivors
            go head-to-head — quarterfinals, semifinals, Grand Final — until one team lifts the trophy.
          </li>
        </ul>
        <p style={{ ...lead, margin: "12px 0 0", fontSize: 13 }}>
          You don&apos;t need to know the teams cold. Tap any team&apos;s{" "}
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-hi)" }}>[ i ]</span>{" "}
          on the board for its roster, world rank, and recent form before you commit.
        </p>
      </div>

      {/* The three calls */}
      <SectionTitle kicker="[ THE CALL ]">A Swiss stage = three predictions</SectionTitle>
      <p style={{ ...lead, marginTop: -2 }}>
        For each Swiss stage you&apos;re answering three questions about the teams:
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Bucket
          tag="3–0"
          color="#34d39a"
          label="Runs the table"
          blurb="Which teams win every match and advance with a perfect record?"
        />
        <Bucket
          tag="ADV"
          color="var(--ink-hi)"
          label="Survives & advances"
          blurb="Which teams make it through with a few wins — not perfect, not eliminated?"
        />
        <Bucket
          tag="0–3"
          color="var(--heat)"
          label="Crashes out"
          blurb="Which teams lose every match and are knocked out of the stage?"
        />
      </div>
      <p style={{ ...lead, marginTop: 2, fontSize: 13 }}>
        Within a group, order doesn&apos;t matter — if you put the right team in the right bucket, that&apos;s
        a hit. You&apos;re sorting teams into outcomes, not ranking them 1-through-10.
      </p>

      {/* Steps */}
      <SectionTitle kicker="[ DO IT ]">Making your first picks</SectionTitle>
      <Step n={1} title="Open the board">
        Head to{" "}
        <Link href="/picks" style={{ color: "var(--heat)" }}>Picks</Link>{" "}
        and select the stage that&apos;s open. A countdown shows how long until it locks.
      </Step>
      <Step n={2} title="Sort the teams">
        Tap a team to drop it into a slot — 3-0, advance, or 0-3. Fill every slot. Not sure on a team?
        Hit its <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-hi)" }}>[ i ]</span> for the dossier first.
      </Step>
      <Step n={3} title="Lock them in">
        Save. Your picks are set until the stage starts, then they&apos;re sealed — no changes once the
        matches are live. (That&apos;s what makes it fair: everyone commits before the action.)
      </Step>
      <Step n={4} title="Watch your score move">
        As matches finish, results land on the board and your points update live. Compare against friends
        on the{" "}
        <Link href="/leaderboard" style={{ color: "var(--heat)" }}>leaderboard</Link>{" "}
        — tap anyone to see their picks next to yours.
      </Step>

      {/* Scoring in one breath */}
      <SectionTitle kicker="[ POINTS ]">Scoring, in one breath</SectionTitle>
      <div className="brk" style={card}>
        <span className="br-tr" />
        <span className="br-bl" />
        <p style={{ ...lead, margin: 0 }}>
          Every correct pick scores. Later Swiss stages are worth more per pick, and in the playoffs the
          <em> early</em> rounds pay the most (calling all four quarterfinals is harder than calling one
          Grand Final). A perfect tournament is <strong style={{ color: "var(--ink-hi)" }}>135 points</strong> —
          but you don&apos;t need perfect to win the board, you just need to beat the people next to you.
        </p>
        <p style={{ margin: "12px 0 0" }}>
          <Link href="/faq" style={{ color: "var(--heat)", fontSize: 13, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Full scoring breakdown in the FAQ →
          </Link>
        </p>
      </div>

      {/* Joining mid-tournament */}
      <SectionTitle kicker="[ LATE ARRIVAL ]">Just joined mid-tournament?</SectionTitle>
      <p style={{ ...lead, marginTop: -2 }}>
        Totally fine — plenty of people are. Here&apos;s how it works depending on how you play:
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div className="brk" style={{ ...card, flex: "1 1 240px", minWidth: 0 }}>
          <span className="br-tr" />
          <span className="br-bl" />
          <div className="panel-title">[ Playing locally ]</div>
          <p style={{ ...lead, margin: "0 0 0", fontSize: 13.5 }}>
            Make your picks for the <strong style={{ color: "var(--ink-hi)" }}>current open stage</strong> and
            you&apos;re in — same board, same scoring as everyone else. Stages that already locked before you
            arrived are closed for you, but every future stage and the whole playoff bracket is yours to call.
          </p>
        </div>
        <div className="brk" style={{ ...card, flex: "1 1 240px", minWidth: 0 }}>
          <span className="br-tr" />
          <span className="br-bl" />
          <div className="panel-title">[ Synced with Steam ]</div>
          <p style={{ ...lead, margin: "0 0 0", fontSize: 13.5 }}>
            If you own the Viewer Pass and already made real picks in-game, connect your{" "}
            <Link href="/help/auth-code" style={{ color: "var(--heat)" }}>Steam auth code</Link>.
            HOTLINE pulls in your <em>official</em> picks — including stages that already locked — and
            backdates the points you earned. You made the calls in time; you just hadn&apos;t used the app yet.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
        <Link href="/picks" className="btn-heat" style={{ flex: "1 1 200px", justifyContent: "center" }}>
          Make your picks
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
        <Link href="/faq" className="btn-ghost" style={{ flex: "1 1 200px", justifyContent: "center" }}>
          Read the FAQ
        </Link>
      </div>
    </>
  );
}
