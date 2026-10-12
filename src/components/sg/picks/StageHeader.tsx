import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Pick'Em stage header (HANDOFF §3): a photo banner with the stage eyebrow +
 * display title on the left and the lockbox on the right — a live countdown to
 * lockTimeForSection while open, the viewer's result once the stage is scored.
 */
export function StageHeader({
  photo,
  eyebrow,
  title,
  lockbox,
}: {
  photo: string;
  eyebrow: ReactNode;
  title: string;
  lockbox: ReactNode;
}) {
  return (
    <section className="sgp-head rise">
      <Image src={photo} alt="" fill priority sizes="(min-width: 1240px) 1176px, 100vw" />
      <div className="sgp-head-title">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="display">{title}</h1>
      </div>
      <div className="sgp-lockbox">{lockbox}</div>
    </section>
  );
}
