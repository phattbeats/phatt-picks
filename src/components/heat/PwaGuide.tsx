"use client";

import { useState } from "react";

type Step = { title: string; body: string };

const IOS: Step[] = [
  { title: "Tap Share", body: "At the bottom of Safari (or top-right on iPad)." },
  { title: "Add to Home Screen", body: "Scroll the share menu and tap the plus-in-square icon." },
  { title: "Confirm", body: "Tap “Add” — HOTLINE lands on your home screen with its own icon." },
];

const ANDROID: Step[] = [
  { title: "Open Browser Menu", body: "Tap the ⋮ menu in Chrome (top-right), or look for the install icon in the address bar on desktop." },
  { title: "Install App", body: "Choose “Install app” or “Add to Home screen”." },
  { title: "Confirm", body: "HOTLINE installs as a standalone app — no browser chrome." },
];

export function PwaGuide() {
  const [tab, setTab] = useState<"ios" | "android">("ios");
  const steps = tab === "ios" ? IOS : ANDROID;

  return (
    <>
      <div className="pwa-tabs">
        <button type="button" className={`pwa-tab${tab === "ios" ? " active" : ""}`} onClick={() => setTab("ios")}>
          iOS · Safari
        </button>
        <button type="button" className={`pwa-tab${tab === "android" ? " active" : ""}`} onClick={() => setTab("android")}>
          Android · Desktop
        </button>
      </div>
      <div className="pwa-steps">
        {steps.map((s, i) => (
          <div key={s.title} className="pwa-step">
            <span className="pwa-step-n">{i + 1}</span>
            <div>
              <div className="pwa-step-title">{s.title}</div>
              <div className="pwa-step-body">{s.body}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
