"use client";

/**
 * Settings → Customize (PHA-4477): pick the three achievements shown off in
 * your profile banner, the felt your coin case is lined with and the banner
 * photo behind your profile. Felts unlock as your PHATT ID levels
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

export interface CharmOption {
  key: string;
  name: string;
  poster: string;
}

export interface ShowcaseOption {
  key: string;
  name: string;
  description: string;
  /** The pin, rendered on the server. */
  pin: React.ReactNode;
}

async function save(patch: { felt?: string | null; banner?: string | null; showcase?: string[]; charms?: string[] }): Promise<boolean> {
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
  showcaseOptions,
  initialShowcase,
  showcaseSize,
  charmOptions,
  initialCharms,
  keyringSize,
}: {
  felts: FeltOption[];
  banners: BannerOption[];
  initialFelt: string;
  initialBanner: string | null;
  defaultBanner: string;
  /** Earned achievements, the only ones that can go in the showcase. */
  showcaseOptions: ShowcaseOption[];
  /** The player's own picks ([] = the default: their hardest unlocks). */
  initialShowcase: string[];
  showcaseSize: number;
  /** Earned charms, the only ones that can hang on the keyring. */
  charmOptions: CharmOption[];
  initialCharms: string[];
  keyringSize: number;
}) {
  const [charms, setCharms] = useState<string[]>(initialCharms);
  const [showcase, setShowcase] = useState<string[]>(initialShowcase);
  const [felt, setFelt] = useState(initialFelt);
  const [banner, setBanner] = useState<string | null>(initialBanner);
  const [err, setErr] = useState<string | null>(null);

  const toggleCharm = async (key: string) => {
    const prev = charms;
    const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    if (next.length > keyringSize) return;
    setCharms(next);
    setErr(null);
    if (!(await save({ charms: next }))) {
      setCharms(prev);
      setErr("Couldn't save your keyring. Try again.");
    }
  };

  const toggleShowcase = async (key: string) => {
    const prev = showcase;
    const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    if (next.length > showcaseSize) return;
    setShowcase(next);
    setErr(null);
    if (!(await save({ showcase: next }))) {
      setShowcase(prev);
      setErr("Couldn't save your showcase. Try again.");
    }
  };
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
      {showcaseOptions.length > 0 && (
        <div className="cz-group">
          <span className="eyebrow">
            Showcase · {showcase.length} of {showcaseSize}
          </span>
          <div className="cz-show" role="group" aria-label={`Showcase: pick up to ${showcaseSize}`}>
            {showcaseOptions.map((a) => {
              const at = showcase.indexOf(a.key);
              const full = at < 0 && showcase.length >= showcaseSize;
              return (
                <button
                  key={a.key}
                  type="button"
                  aria-pressed={at >= 0}
                  disabled={full}
                  className={`cz-ach${at >= 0 ? " on" : ""}`}
                  onClick={() => toggleShowcase(a.key)}
                  title={full ? `Take one out first: the showcase holds ${showcaseSize}` : a.description}
                >
                  {a.pin}
                  <span className="cz-ach-nm">{a.name}</span>
                  {at >= 0 && <span className="cz-ach-n">{at + 1}</span>}
                </button>
              );
            })}
          </div>
          <p className="nf-meta">
            {showcase.length === 0
              ? `These sit in your profile banner. Until you pick, it shows your hardest ${showcaseSize}.`
              : "These sit in your profile banner, in this order. The rest are listed underneath."}
          </p>
        </div>
      )}

      {charmOptions.length > 0 && (
        <div className="cz-group">
          <span className="eyebrow">
            Keyring · {charms.length} of {keyringSize}
          </span>
          <div className="cz-show" role="group" aria-label={`Keyring: pick up to ${keyringSize}`}>
            {charmOptions.map((c) => {
              const at = charms.indexOf(c.key);
              const full = at < 0 && charms.length >= keyringSize;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={at >= 0}
                  disabled={full}
                  className={`cz-ach${at >= 0 ? " on" : ""}`}
                  onClick={() => toggleCharm(c.key)}
                  title={full ? `Take one off first: the keyring holds ${keyringSize}` : c.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.poster} alt="" width={36} height={36} className="cz-charm-img" />
                  <span className="cz-ach-nm">{c.name}</span>
                  {at >= 0 && <span className="cz-ach-n">{at + 1}</span>}
                </button>
              );
            })}
          </div>
          <p className="nf-meta">
            {charms.length === 0
              ? "These hang on your profile. Until you pick, it shows the charms you hold."
              : "These hang on your profile keyring, in this order."}
          </p>
        </div>
      )}

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
