/* eslint-disable @next/next/no-img-element -- editorial photo from /public. */

/**
 * PHATT ID haul (PHA-4477) — where the bell's "Your achievements from IEM
 * Cologne 2026" entry lands. Brandon 10/24: an actual notification, not a popup over the page, so a
 * player who just came back isn't overloaded and can go through it at their
 * own pace. Walks them through what HOTLINE credited them from earlier Majors
 * (achievements as pins, the XP banked) and what it unlocks. XP, never the
 * level number: that stays hidden until PHATT ID sign-in is live.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getWelcomeHaul } from "@/lib/progression";
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, FELTS, SHOWCASE_SIZE, XP } from "@/lib/progression-core";
import { getEventConfig } from "@/lib/events-core";
import { majorShortName } from "@/components/sg/people/people-data";
import { TrinketPin } from "@/components/sg/people/Achievements";
import { PHOTOS } from "@/lib/photos";
import { MarkWelcomeRead } from "./MarkWelcomeRead";

export const metadata = { title: "PHATT ID · HOTLINE" };
export const dynamic = "force-dynamic";

function dateLabel(atMs: number): string {
  return new Date(atMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function PhattIdPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const haul = await getWelcomeHaul(session.playerId);
  const profile = `/players/${encodeURIComponent(session.playerId)}`;
  const n = haul.unlocks.length;
  const where = haul.majors.length === 1 ? haul.majors[0] : "earlier Majors";
  const majorName = (eid: number | null) => {
    const cfg = eid != null ? getEventConfig(eid) : null;
    return cfg ? majorShortName(cfg) : null;
  };

  return (
    <div className="pp-page pid">
      {n > 0 && <MarkWelcomeRead entryId={haul.entryId} />}
      <section className="bleed short">
        <img src={PHOTOS.phattIdHero} alt="" />
        <span className="credit">Photo · HLTV</span>
        <div className="in">
          <span className="eyebrow rise">
            <b>PHATT ID</b> · New on HOTLINE
          </span>
          <h1 className="display rise d1">{n > 0 ? "Your calls count" : "Achievements"}</h1>
          <p className="rise d2">
            HOTLINE is part of PHATT ID now: one account that levels up across the PHATT arcade.
            {n > 0 ? (
              <>
                {" "}
                We went back over {where} and <b>credited what you earned.</b>
              </>
            ) : (
              <> Your first picks start it.</>
            )}
          </p>
          {n > 0 && (
            <div className="pid-stats rise d2">
              <span>
                <b>{n}</b> achievement{n === 1 ? "" : "s"}
              </span>
              <span>
                <b>{haul.xp.toLocaleString("en-US")}</b> XP banked
              </span>
            </div>
          )}
        </div>
      </section>

      {n > 0 && (
        <section className="chap">
          <div className="chap-h row2">
            <div>
              <span className="n">01 · From {where}</span>
              <h2>What you earned</h2>
              <p>Each achievement drops a trinket pin, worked out from the picks and results already on HOTLINE.</p>
            </div>
            <Link href={`${profile}#achievements`} prefetch={false} className="eyebrow">
              On your profile →
            </Link>
          </div>
          <ol className="ach-list">
            {haul.unlocks.map((u) => {
              const def = ACHIEVEMENT_BY_KEY.get(u.key);
              if (!def) return null;
              const major = majorName(u.eventId);
              return (
                <li key={u.key} className="ach-li on">
                  <TrinketPin def={def} earned size={48} />
                  <div className="ach-txt">
                    <span className="ach-nm">{def.name}</span>
                    <span className="ach-desc">{def.description}</span>
                  </div>
                  <span className="ach-meta">
                    {major && (
                      <>
                        {major}
                        <br />
                      </>
                    )}
                    {dateLabel(u.atMs)}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="chap">
        <div className="chap-h row2">
          <div>
            <span className="n">{n > 0 ? "02" : "01"} · Unlocks</span>
            <h2>What it opens up</h2>
            <p>All cosmetic. Your points and rank never change.</p>
          </div>
          <Link href="/settings#customize" prefetch={false} className="eyebrow">
            Customize →
          </Link>
        </div>
        <ul className="pid-unlocks">
          <li>
            <span className="eyebrow">Showcase</span>
            <b>Pick {SHOWCASE_SIZE} to show off</b>
            <p>Your top {SHOWCASE_SIZE} achievements sit in your profile banner. The rest are listed underneath.</p>
          </li>
          <li>
            <span className="eyebrow">Banner photos</span>
            <b>
              {n} of {ACHIEVEMENTS.length} yours
            </b>
            <p>Every achievement unlocks an HLTV shot for the back of your profile.</p>
          </li>
          <li>
            <span className="eyebrow">Case felts</span>
            <b>
              {haul.feltsUnlocked} of {FELTS.length} open
            </b>
            <p>New felts for your coin case come as your XP adds up.</p>
          </li>
        </ul>
      </section>

      <section className="chap">
        <div className="chap-h">
          <span className="n">{n > 0 ? "03" : "02"} · XP</span>
          <h2>How XP adds up</h2>
          <p>
            {`${XP.showingUp} for showing up, ${XP.stageEntered} for each stage you enter, ${XP.majorFinished} for finishing a Major and ${XP.achievement} for every achievement.`}{" "}
            Points and rank don&apos;t earn XP; they earn coins and achievements. Your level shows once PHATT ID
            sign-in goes live across the arcade.
          </p>
        </div>
        <p className="pid-ctas">
          <Link href={`${profile}#achievements`} prefetch={false} className="btn-solid">
            See my profile
          </Link>
          <Link href="/settings#customize" prefetch={false} className="btn-ghost">
            Customize
          </Link>
        </p>
      </section>
    </div>
  );
}
