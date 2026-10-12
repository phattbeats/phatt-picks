"use client";

import { useState } from "react";
import { randomName, DISPLAY_NAME_MAX } from "@/lib/local-auth-core";

/**
 * Display-name input with a live character count and a dice button that rolls
 * a fresh `randomName()`. Submits as `displayName` inside the server-rendered
 * POST form to /api/auth/local. `suggested` comes from the server so SSR and
 * hydration agree.
 */
export function LocalNameField({ suggested }: { suggested: string }) {
  const [value, setValue] = useState(suggested);

  return (
    <>
      <label className="cap" htmlFor="displayName">
        <span>Display name</span>
        <span aria-hidden>
          {value.length}/{DISPLAY_NAME_MAX}
        </span>
      </label>
      <div className="namebox">
        <input
          className="input"
          id="displayName"
          name="displayName"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          required
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button type="button" className="dice" aria-label="Suggest another name" onClick={() => setValue(randomName())}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <circle cx="9" cy="9" r="1" fill="currentColor" />
            <circle cx="15" cy="15" r="1" fill="currentColor" />
            <circle cx="15" cy="9" r="1" fill="currentColor" />
            <circle cx="9" cy="15" r="1" fill="currentColor" />
          </svg>
        </button>
      </div>
    </>
  );
}
