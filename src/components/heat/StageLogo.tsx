import type { CSSProperties } from "react";

/**
 * StageLogo (PHA-1054) — a stylized "STAGE I / II / III" lockup in the HEAT
 * brand language: the Big Shoulders display face, the animated gold `--foil`
 * gradient on the numeral, and the tactical corner-bracket frame (`.brk`) +
 * heat glow used across the app's panels and wordmark. Pure/presentational
 * (no hooks) so it renders in both server and client trees.
 *
 * Used as the hero mark on the Stage Wrapped cover; reusable anywhere a stage
 * needs a proper logo rather than plain "Stage 1" text.
 */
export function StageLogo({
  numeral,
  label = "STAGE",
  sub,
  size = 92,
}: {
  /** Roman numeral, e.g. "I" / "II" / "III". */
  numeral: string;
  /** Small word above the numeral. */
  label?: string;
  /** Optional caption under the numeral, e.g. "WRAPPED". */
  sub?: string;
  /** Numeral font-size in px. */
  size?: number;
}) {
  const frame: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "14px 28px 12px",
    margin: "0 auto",
  };
  return (
    <div className="stage-logo brk" style={frame} role="img" aria-label={`${label} ${numeral}`}>
      <span className="br-tr" />
      <span className="br-bl" />
      <span
        className="eyebrow-mono"
        style={{ color: "var(--heat)", fontSize: 11, letterSpacing: "0.42em", textIndent: "0.42em", lineHeight: 1 }}
      >
        {label}
      </span>
      <span
        className="font-display foil"
        style={{
          fontWeight: 800,
          fontSize: size,
          lineHeight: 0.8,
          letterSpacing: numeral.length > 2 ? "0.005em" : "0.04em",
          // Halo behind the foil glyphs — the heat glow the wordmark/mark use.
          filter: "drop-shadow(0 0 14px var(--heat-glow))",
        }}
      >
        {numeral}
      </span>
      {sub && (
        <span
          className="eyebrow-mono"
          style={{ color: "var(--ink-mid)", fontSize: 9.5, letterSpacing: "0.34em", textIndent: "0.34em", lineHeight: 1, marginTop: 3 }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

export { stageNumeral } from "@/lib/stage-wrapped-core";
