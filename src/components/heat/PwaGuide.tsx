"use client";

import { useState } from "react";

type Step = { title: string; body: string };

const IOS: Step[] = [
  { title: "Tap Share", body: "At the bottom of Safari — top-right on iPad." },
  { title: "Add to Home Screen", body: "Scroll the share sheet and tap the plus-in-square icon." },
  { title: "Open from the icon", body: "Tap “Add”, then launch HOTLINE from your home screen and allow notifications when asked." },
];

const ANDROID: Step[] = [
  { title: "Open the menu", body: "Chrome’s ⋮ menu (top-right), or the install icon in the address bar on desktop." },
  { title: "Install app", body: "Choose “Install app” or “Add to Home screen”." },
  { title: "Confirm", body: "HOTLINE opens standalone — no browser chrome." },
];

/** Install steps (prototype 21): hairline tabs over the shared numbered .steps list. */
export function PwaGuide() {
  const [tab, setTab] = useState<"ios" | "android">("ios");
  const steps = tab === "ios" ? IOS : ANDROID;

  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Platform">
        <button type="button" role="tab" aria-selected={tab === "ios"} className={tab === "ios" ? "on" : undefined} onClick={() => setTab("ios")}>
          iPhone · Safari
        </button>
        <button type="button" role="tab" aria-selected={tab === "android"} className={tab === "android" ? "on" : undefined} onClick={() => setTab("android")}>
          Android · Desktop
        </button>
      </div>
      <div className="steps" role="tabpanel">
        {steps.map((s, i) => (
          <div key={s.title}>
            <span className="n">{i + 1}</span>
            <div>
              <div className="t">{s.title}</div>
              <p>{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
