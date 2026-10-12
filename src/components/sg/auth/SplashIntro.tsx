"use client";

/* eslint-disable @next/next/no-img-element -- static brand PNGs + the full-bleed photo; next/image adds nothing here. */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Splash intro → sign-in (HANDOFF §5e). The ticket-H is drawn as inline SVG on
 * the brand's 976×1024 grid, punched, then the whole lockup flies into the
 * top-left nav slot while the stadium photo pulls back and the sign-in content
 * (server-rendered `children`) staggers in.
 *
 * - First visit ≈ 3.3s; returning (localStorage flag) settles ~0.65s then flies.
 * - Tap / Enter / Space / Esc skips straight to the zoom-out.
 * - prefers-reduced-motion skips entirely (CSS hides the overlay pre-hydration).
 * - `override` comes from ?intro=first | ?intro=return.
 *
 * Pure CSS animation; this component only sequences class changes. The SSR
 * render holds every intro animation paused at its first frame ("wait") so
 * nothing plays before we know which variant to run — no hydration mismatch.
 */

const SEEN_KEY = "hl-intro-seen";
const FIRST_HOLD_MS = 2250;
const RETURN_HOLD_MS = 650;
const FLY_MS = 1120;
const IMG_WAIT_CAP_MS = 1500;

type Phase = "wait" | "play" | "leave" | "done";

export function SplashIntro({
  override,
  photo,
  children,
}: {
  override?: "first" | "return" | null;
  photo: string;
  children: React.ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>("wait");
  const [returning, setReturning] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const lkRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef(false);

  const leave = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode — fine */
    }
    const lk = lkRef.current;
    const target = rootRef.current?.querySelector<HTMLElement>(".top .brand .lockup");
    if (lk && target) {
      const a = lk.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      if (a.width && b.width) {
        lk.classList.add("fly");
        lk.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})`;
      }
    }
    setPhase("leave");
    window.setTimeout(() => setPhase("done"), FLY_MS);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      leftRef.current = true;
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* ignore */
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot client-only decision (matchMedia) after hydration
      setPhase("done");
      return;
    }

    let seen = override === "return";
    if (!override) {
      try {
        seen = localStorage.getItem(SEEN_KEY) === "1";
      } catch {
        seen = false;
      }
    }

    let cancelled = false;
    let holdTimer = 0;
    const imgs = [
      ...(overlayRef.current?.querySelectorAll("img") ?? []),
      ...(rootRef.current?.querySelectorAll<HTMLImageElement>(".top .brand .lockup") ?? []),
    ];
    const loaded = Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
      ),
    );
    const cap = new Promise<void>((resolve) => window.setTimeout(resolve, IMG_WAIT_CAP_MS));
    Promise.race([loaded, cap]).then(() => {
      if (cancelled || leftRef.current) return;
      setReturning(seen);
      setPhase("play");
      holdTimer = window.setTimeout(leave, seen ? RETURN_HOLD_MS : FIRST_HOLD_MS);
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        if (leftRef.current) return;
        e.preventDefault();
        leave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.clearTimeout(holdTimer);
      window.removeEventListener("keydown", onKey);
    };
  }, [override, leave]);

  const rootCls =
    phase === "wait" || phase === "play"
      ? " is-intro"
      : phase === "leave"
        ? " is-flying"
        : "";
  const introCls =
    "sg-intro" +
    (phase === "wait" ? " is-wait" : "") +
    (returning ? " ret" : "") +
    (phase === "leave" ? " leaving" : "");

  return (
    <>
      <div ref={rootRef} className={`full sg-auth sg-splash${rootCls}`} data-screen-label="Splash / Sign in">
        <div className="bgp">
          <img src={photo} alt="" />
        </div>
        {children}
      </div>

      {phase !== "done" && (
        <div ref={overlayRef} className={introCls} onClick={leave} aria-hidden>
          <div className="veil" />
          <div className="col">
            <span className="boot">
              <i />
              Line open
            </span>
            <div className="lkwrap">
              <div className="lk" ref={lkRef}>
                <div className="sym">
                  <svg viewBox="0 0 976 1024">
                    <path
                      className="t-out"
                      pathLength={1000}
                      d="M88 32H888A56 56 0 0 1 944 88V416A96 96 0 0 0 944 608V936A56 56 0 0 1 888 992H88A56 56 0 0 1 32 936V608A96 96 0 0 0 32 416V88A56 56 0 0 1 88 32Z"
                    />
                    <path
                      className="t-fill"
                      d="M88 32H888A56 56 0 0 1 944 88V416A96 96 0 0 0 944 608V936A56 56 0 0 1 888 992H88A56 56 0 0 1 32 936V608A96 96 0 0 0 32 416V88A56 56 0 0 1 88 32Z"
                    />
                    <rect className="h-l" x="248" y="212" width="172" height="600" />
                    <rect className="h-r" x="556" y="212" width="172" height="600" />
                    <rect className="h-x" x="418" y="440" width="140" height="144" />
                    <circle className="punch" cx="32" cy="512" r="96" />
                    <circle className="punch" cx="944" cy="512" r="96" />
                  </svg>
                  <img src="/brand/symbol-amber.png" alt="" />
                  <span className="lock" />
                </div>
                <img className="wm" src="/brand/wordmark-cream.png" alt="" />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
