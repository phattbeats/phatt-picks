"use client";

/**
 * Settings → Customize (PHA-4477): pick the felt your coin case is lined with
 * and the banner photo behind your profile. Felts unlock as your PHATT ID levels
 * up (the level number itself stays hidden until PHATT ID sign-in is live);
 * banners unlock with achievements. Optimistic: the choice shows at once, the
 * PATCH to /api/loadout follows, and a refusal puts the old choice back.
 */

import { useState } from "react";

export interface FeltOption {
  key: string;
  name: string;
  tile: string;
  bed: string;
  unlocked: boolean;
}

export interface BannerOption {
  key: string;
  label: string;
  src: string;
  achievement: string;
  unlocked: boolean;
}

async function save(patch: { felt?: string | null; banner?: string | null }): Promise<boolean> {
  try {
    const r = await fetch("/api/loadout", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function CustomizePanel({
  felts,
  banners,
  initialFelt,
  initialBanner,
  defaultBanner,
}: {
  felts: FeltOption[];
  banners: BannerOption[];
  initialFelt: string;
  initialBanner: string | null;
  defaultBanner: string;
}) {
  const [felt, setFelt] = useState(initialFelt);
  const [banner, setBanner] = useState<string | null>(initialBanner);
  const [err, setErr] = useState<string | null>(null);

  const pickFelt = async (key: string) => {
    const prev = felt;
    setFelt(key);
    setErr(null);
    if (!(await save({ felt: key }))) {
      setFelt(prev);
      setErr("Couldn't save that felt. Try again.");
    }
  };
  const pickBanner = async (key: string | null) => {
    const prev = banner;
    setBanner(key);
    setErr(null);
    if (!(await save({ banner: key }))) {
      setBanner(prev);
      setErr("Couldn't save that banner. Try again.");
    }
  };

  const earnedBanners = banners.filter((b) => b.unlocked);
  const lockedBanners = banners.length - earnedBanners.length;

  return (
    <div className="cz">
      <div className="cz-group">
        <span className="eyebrow">Case felt</span>
        <div className="cz-felts" role="radiogroup" aria-label="Case felt">
          {felts.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={felt === f.key}
              disabled={!f.unlocked}
              className={`cz-felt${felt === f.key ? " on" : ""}${f.unlocked ? "" : " locked"}`}
              style={{ background: `${f.bed} url(${f.tile}) center / cover no-repeat` }}
              onClick={() => f.unlocked && felt !== f.key && pickFelt(f.key)}
              title={f.unlocked ? f.name : `${f.name}: unlocks as your PHATT ID levels up`}
            >
              <span className="cz-felt-nm">{f.name}</span>
              {!f.unlocked && <span className="cz-lock">Locked</span>}
            </button>
          ))}
        </div>
        <p className="nf-meta">New felts unlock as your PHATT ID levels up.</p>
      </div>

      <div className="cz-group">
        <span className="eyebrow">Profile banner</span>
        <div className="cz-banners" role="radiogroup" aria-label="Profile banner">
          <button
            type="button"
            role="radio"
            aria-checked={banner === null}
            className={`cz-banner${banner === null ? " on" : ""}`}
            onClick={() => banner !== null && pickBanner(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={defaultBanner} alt="" loading="lazy" />
            <span className="cz-banner-nm">Default</span>
          </button>
          {earnedBanners.map((b) => (
            <button
              key={b.key}
              type="button"
              role="radio"
              aria-checked={banner === b.key}
              className={`cz-banner${banner === b.key ? " on" : ""}`}
              onClick={() => banner !== b.key && pickBanner(b.key)}
              title={`${b.label} · from ${b.achievement}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.src} alt="" loading="lazy" />
              <span className="cz-banner-nm">{b.label}</span>
            </button>
          ))}
        </div>
        <p className="nf-meta">
          {lockedBanners > 0
            ? `Each achievement unlocks a banner photo; ${lockedBanners} still to earn.`
            : "Every banner photo is yours."}
        </p>
      </div>
      {err && <p className="nf-meta cz-err" role="alert">{err}</p>}
    </div>
  );
}
