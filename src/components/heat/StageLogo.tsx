/**
 * StageLogo (#1054) — a "STAGE I / II / III" lockup: an amber mono label over a
 * Big Shoulders numeral. Singapore skin: flat ink, no foil, glow or corner
 * brackets (styles in sg-picks.css, `.stage-logo`). Pure/presentational (no
 * hooks) so it renders in both server and client trees.
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
  return (
    <div className="stage-logo" role="img" aria-label={`${label} ${numeral}`}>
      <span className="lbl">{label}</span>
      <span
        className="num"
        style={{ fontSize: size, letterSpacing: numeral.length > 2 ? "0.005em" : "0.04em" }}
      >
        {numeral}
      </span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export { stageNumeral } from "@/lib/stage-wrapped-core";
