import Link from "next/link";
import { HeatWordmark } from "@/components/heat/HeatMark";

/**
 * Splash screen — the gate before sign-in.
 *
 * Minimalist by composition, brand-native by motion: the HOTLINE reticle
 * doesn't just appear, it *acquires a target and locks on* — a radar sweep
 * spins up, the corner brackets and crosshair draw themselves into place, the
 * center dot punches in, and a single lock-pulse confirms the lock. Then the
 * wordmark and ENTER button settle in. Pure CSS; no JS, no client bundle.
 *
 * Reduced-motion safe: every hidden state lives in a keyframe `from`, so when
 * the global `prefers-reduced-motion` rule disables animation the final,
 * fully-visible state is what renders.
 */
export default function SplashPage() {
  return (
    <main
      style={{
        position: "relative",
        zIndex: 3,
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        gap: 34,
      }}
    >
      {/* Boot status — the system spinning up */}
      <span className="sp-boot">
        <i className="sp-boot-dot" />
        Signal acquired
      </span>

      {/* Reticle — acquires and locks on */}
      <div className="sp-mark">
        <span className="sp-sweep" aria-hidden />
        <span className="sp-lockring" aria-hidden />
        <svg className="sp-reticle" viewBox="0 0 64 64" aria-hidden>
          <path className="sp-br" d="M 6 18 L 6 6 L 18 6" />
          <path className="sp-br" d="M 46 6 L 58 6 L 58 18" />
          <path className="sp-br" d="M 58 46 L 58 58 L 46 58" />
          <path className="sp-br" d="M 18 58 L 6 58 L 6 46" />
          <circle className="sp-ring" cx={32} cy={32} r={13} />
          <line className="sp-cross" x1={6} y1={32} x2={17} y2={32} />
          <line className="sp-cross" x1={47} y1={32} x2={58} y2={32} />
          <circle className="sp-dot" cx={32} cy={32} r={3.6} />
        </svg>
      </div>

      {/* Wordmark + scope context */}
      <div className="sp-id">
        <span className="sp-word">
          <HeatWordmark size={52} />
        </span>
        <span className="sp-rule" aria-hidden />
        <span className="sp-tag">IEM Cologne 2026 · Pick&apos;Em Companion</span>
      </div>

      {/* The gate */}
      <span className="sp-enter">
        <Link href="/login/auth" className="btn-heat" style={{ minWidth: 168, justifyContent: "center" }}>
          Enter
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      </span>

      <style>{`
        /* ── Reticle frame ─────────────────────────────────────────────── */
        .sp-mark {
          position: relative;
          width: 132px; height: 132px;
          display: grid; place-items: center;
          /* snap-to-focus: scope settling onto the mark */
          animation: sp-focus 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.05s both;
        }
        .sp-reticle {
          width: 116px; height: 116px; overflow: visible;
          filter: drop-shadow(0 0 10px var(--heat-glow));
        }
        .sp-reticle .sp-br,
        .sp-reticle .sp-ring,
        .sp-reticle .sp-cross {
          fill: none; stroke: var(--heat);
          stroke-linecap: square; stroke-linejoin: miter;
          stroke-dashoffset: 0;
        }
        .sp-br    { --l: 24; stroke-width: 4; stroke-dasharray: 24; animation: sp-draw 0.5s var(--ease) both; }
        .sp-ring  { --l: 82; stroke-width: 4; stroke-dasharray: 82; animation: sp-draw 0.65s var(--ease) 0.42s both; }
        .sp-cross { --l: 11; stroke-width: 3; stroke-dasharray: 11; animation: sp-draw 0.32s var(--ease) 0.5s both; }
        .sp-reticle .sp-br:nth-of-type(1) { animation-delay: 0.22s; }
        .sp-reticle .sp-br:nth-of-type(2) { animation-delay: 0.30s; }
        .sp-reticle .sp-br:nth-of-type(3) { animation-delay: 0.38s; }
        .sp-reticle .sp-br:nth-of-type(4) { animation-delay: 0.46s; }
        .sp-dot {
          fill: var(--heat);
          transform-box: fill-box; transform-origin: center;
          animation: sp-dot 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.62s both;
        }

        /* Radar sweep — the spin-up */
        .sp-sweep {
          position: absolute; width: 116px; height: 116px; border-radius: 50%;
          background: conic-gradient(from 0deg,
            transparent 250deg,
            rgba(240,163,0,0.28) 330deg,
            rgba(240,163,0,0.85) 360deg);
          -webkit-mask: radial-gradient(circle, transparent 36%, #000 38%, #000 49%, transparent 51%);
                  mask: radial-gradient(circle, transparent 36%, #000 38%, #000 49%, transparent 51%);
          opacity: 0;
          animation: sp-sweep 1.5s linear 0.05s 1 both;
        }

        /* Lock confirmation pulse */
        .sp-lockring {
          position: absolute; width: 92px; height: 92px; border-radius: 50%;
          border: 1.5px solid var(--heat);
          opacity: 0;
          animation: sp-lock 0.7s var(--ease) 0.92s 1 both;
        }

        /* ── Identity block ────────────────────────────────────────────── */
        .sp-id { display: flex; flex-direction: column; align-items: center; gap: 14px; }
        .sp-word { animation: sp-rise 0.6s var(--ease) 1.0s both; }
        .sp-rule {
          width: 64px; height: 1px;
          background: linear-gradient(90deg, transparent, var(--hair-3), transparent);
          transform-origin: center;
          animation: sp-rule 0.7s var(--ease) 1.18s both;
        }
        .sp-tag {
          font-family: var(--font-mono);
          font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
          color: var(--ink-mid);
          animation: sp-rise 0.6s var(--ease) 1.28s both;
        }

        /* ── Boot line ─────────────────────────────────────────────────── */
        .sp-boot {
          display: inline-flex; align-items: center; gap: 8px;
          font-family: var(--font-mono);
          font-size: 9px; letter-spacing: 0.28em; text-transform: uppercase;
          color: var(--ink-low);
          animation: sp-rise 0.6s var(--ease) 0.7s both;
        }
        .sp-boot-dot {
          width: 5px; height: 5px; background: var(--heat);
          box-shadow: 0 0 8px var(--heat);
          animation: live-blink 1.6s steps(2, end) 1.4s infinite;
        }

        /* ── Enter ─────────────────────────────────────────────────────── */
        .sp-enter {
          position: relative;
          animation: sp-rise 0.6s var(--ease) 1.5s both;
        }
        .sp-enter::before {
          content: ''; position: absolute; inset: -10px;
          border-radius: 10px;
          background: radial-gradient(ellipse at center, var(--heat-glow), transparent 70%);
          opacity: 0; z-index: -1; pointer-events: none;
          animation: sp-breathe 3.2s ease-in-out 2.1s infinite;
        }

        /* ── Keyframes ─────────────────────────────────────────────────── */
        @keyframes sp-focus {
          from { opacity: 0; transform: scale(1.55) rotate(-7deg); }
          to   { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes sp-draw {
          from { stroke-dashoffset: var(--l, 82); }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes sp-dot {
          from { opacity: 0; transform: scale(0); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes sp-sweep {
          0%   { opacity: 0; transform: rotate(0deg); }
          15%  { opacity: 1; }
          80%  { opacity: 0.9; }
          100% { opacity: 0; transform: rotate(740deg); }
        }
        @keyframes sp-lock {
          0%   { opacity: 0; transform: scale(0.7); }
          35%  { opacity: 0.9; }
          100% { opacity: 0; transform: scale(1.5); }
        }
        @keyframes sp-rise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes sp-rule {
          from { opacity: 0; transform: scaleX(0); }
          to   { opacity: 1; transform: scaleX(1); }
        }
        @keyframes sp-breathe {
          0%, 100% { opacity: 0; }
          50%      { opacity: 1; }
        }
      `}</style>
    </main>
  );
}
