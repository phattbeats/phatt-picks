/* eslint-disable @next/next/no-img-element -- static decorative device mock (photo + app icon). */

import Link from "next/link";
import { PwaGuide } from "@/components/heat/PwaGuide";

export const metadata = { title: "Install · HOTLINE" };

/** PWA install guide (prototype 21): copy + steps beside a home-screen mock. */
export default function PwaInstallPage() {
  return (
    <div className="sgc-ed">
      <div className="sgc-pwa">
        <div className="col">
          <div className="chap-h rise">
            <span className="n">Home screen</span>
            <h1>
              Put it
              <br />
              in your pocket
            </h1>
            <p>
              One tap to your picks, and <b>lock alerts</b> that actually reach you. On iPhone, alerts
              only work from the installed app.
            </p>
          </div>
          <div className="rise d1">
            <PwaGuide />
          </div>
          <div className="cta rise d2">
            <Link href="/" prefetch={false} className="btn-solid">Done</Link>
            <Link href="/info" prefetch={false} className="btn-ghost">More guides</Link>
          </div>
          <p className="sgc-pwa-note">iOS requires the installed app for notifications to work.</p>
        </div>
        <div className="sgc-dev rise d1" aria-hidden>
          <img className="bg" src="/wrapped/major-cover.jpg" alt="" />
          <div className="grid">
            <i /><i /><i /><i /><i />
            <span className="hl"><img src="/brand/app-icon.png" alt="" /></span>
            <i /><i /><i /><i /><i /><i />
          </div>
        </div>
      </div>
    </div>
  );
}
