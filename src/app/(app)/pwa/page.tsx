import { HeatMark } from "@/components/heat/HeatMark";
import { PwaGuide } from "@/components/heat/PwaGuide";

export const metadata = { title: "Install · HOTLINE" };

export default function PwaInstallPage() {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", padding: "8px 0 4px" }}>
        <HeatMark size={48} />
        <div>
          <span className="eyebrow-mono">DEPLOY TO HOME SCREEN</span>
          <h1 className="font-display" style={{
            fontWeight: 900,
            fontSize: "clamp(30px, 6vw, 44px)",
            textTransform: "uppercase",
            lineHeight: 0.95,
            margin: "6px 0 0",
          }}>
            Install HOTLINE
          </h1>
        </div>
        <p style={{ color: "var(--ink-mid)", fontSize: 14, maxWidth: 340, margin: 0, lineHeight: 1.5 }}>
          Pin it for one-tap access and live pick-lock alerts during the Major.
        </p>
      </div>

      <PwaGuide />

      <p style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ink-low)",
        textAlign: "center",
        margin: "4px 0 0",
      }}>
        iOS requires the installed app for notifications to work.
      </p>
    </>
  );
}
