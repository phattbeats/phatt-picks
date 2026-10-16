"use client";

/** Settings row for the coach-mark tips: on/off switch + "Reset tips". */

import { useState } from "react";
import { coachStore, useCoach } from "./coach-store";

export function TipsSettingRow() {
  const { state } = useCoach();
  const [didReset, setDidReset] = useState(false);
  const on = !state.off;

  return (
    <div className="row coach-set">
      <div>
        <div className="t">Tips</div>
        <div className="s" aria-live="polite">
          {didReset ? "Reset. Tips will show again as you get around." : "The blue bubbles that point out how things work."}
        </div>
      </div>
      <div className="coach-set-c">
        <button
          type="button"
          className="btn-ghost nf-btn-sm"
          onClick={() => {
            coachStore.reset();
            setDidReset(true);
          }}
        >
          Reset tips
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Show tips"
          className={`sw${on ? " on" : ""}`}
          onClick={() => {
            coachStore.setOff(on);
            setDidReset(false);
          }}
        />
      </div>
    </div>
  );
}
