"use client";

/* eslint-disable @next/next/no-img-element -- small static cutouts from /public/wrapped. */

import { useState } from "react";

/**
 * How it works · chapter 03 — a self-contained tap-to-place sandbox. It mirrors
 * the real board's primary input (tap a team, tap a slot; tap a filled slot to
 * clear it) without touching any picks state or API. Illustrative only.
 */

type DemoTeam = { key: string; name: string; img: string };

const TEAMS: DemoTeam[] = [
  { key: "fal", name: "Falcons", img: "/wrapped/player-139.webp" },
  { key: "vit", name: "Vitality", img: "/wrapped/player-89.webp" },
  { key: "fur", name: "FURIA", img: "/wrapped/player-85.webp" },
  { key: "9z", name: "9z", img: "/wrapped/player-112.webp" },
];

const SLOTS: { code: string; label: string }[] = [
  { code: "3–0", label: "Sweep" },
  { code: "ADV", label: "Advance" },
  { code: "0–3", label: "Out" },
];

export function TapDemo() {
  const [sel, setSel] = useState<string | null>(null);
  const [placed, setPlaced] = useState<(string | null)[]>([null, null, null]);

  const nameOf = (k: string) => TEAMS.find((t) => t.key === k)?.name ?? k;
  const filled = placed.filter(Boolean).length;

  function tapSlot(i: number) {
    if (sel) {
      setPlaced((p) => p.map((v, j) => (j === i ? sel : v)));
      setSel(null);
    } else if (placed[i]) {
      setPlaced((p) => p.map((v, j) => (j === i ? null : v)));
    }
  }

  let msg: React.ReactNode = "Pick a team to start.";
  if (filled === 3) {
    msg = (
      <>
        <b>That&apos;s a Pick&apos;Em.</b> The real board asks for ten per stage: two sweeps, six
        advancers, two wipeouts.
      </>
    );
  } else if (sel) {
    msg = (
      <>
        Now tap a bucket for <b>{nameOf(sel)}</b>.
      </>
    );
  } else if (filled) {
    msg = "Nice. Keep going — tap a placed team to take it back out.";
  }

  return (
    <div className="sgc-demo">
      <div className="teams" role="group" aria-label="Demo teams">
        {TEAMS.map((t) => {
          const used = placed.includes(t.key);
          return (
            <button
              key={t.key}
              type="button"
              className={`sgc-dt${sel === t.key ? " sel" : ""}`}
              aria-pressed={sel === t.key}
              disabled={used}
              onClick={() => setSel((s) => (s === t.key ? null : t.key))}
            >
              <img src={t.img} alt="" loading="lazy" />
              <span>{t.name}</span>
            </button>
          );
        })}
      </div>
      <div className="side">
        <div className="sgc-dslots" role="group" aria-label="Demo buckets">
          {SLOTS.map((s, i) => {
            const k = placed[i];
            if (k) {
              return (
                <button key={s.code} type="button" className="sgc-ds on" onClick={() => tapSlot(i)} aria-label={`${nameOf(k)} in ${s.label} — tap to clear`}>
                  <span>{nameOf(k)}</span>
                  <b>{s.code}</b>
                </button>
              );
            }
            return (
              <button key={s.code} type="button" className={`sgc-ds${sel ? " armed" : ""}`} onClick={() => tapSlot(i)}>
                <span>{sel ? "Tap to place" : s.label}</span>
                <b>{s.code}</b>
              </button>
            );
          })}
        </div>
        <p className="sgc-dmsg" aria-live="polite">{msg}</p>
      </div>
    </div>
  );
}
