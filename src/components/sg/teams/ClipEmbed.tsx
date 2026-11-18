"use client";

/**
 * Click-to-load YouTube clip. Renders only a poster + play button until tapped,
 * so a team page with three clips costs three thumbnails, not three iframes.
 * The "Watch on YouTube" link is always present, so a blocked or
 * embed-disabled video still has a clean way out.
 */

import { useState } from "react";
import { youtubeEmbedSrc, youtubeWatchUrl, type StoryClip } from "@/lib/team-stories";

export function ClipEmbed({ clip }: { clip: StoryClip }) {
  const [on, setOn] = useState(false);
  return (
    <figure className="sgt-clip">
      <div className="frame">
        {on ? (
          <iframe
            src={youtubeEmbedSrc(clip)}
            title={clip.title}
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button type="button" onClick={() => setOn(true)} aria-label={`Play: ${clip.title}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- remote poster, lazy */}
            <img src={`https://i.ytimg.com/vi/${clip.id}/hqdefault.jpg`} alt="" loading="lazy" decoding="async" />
            <span className="play" aria-hidden="true" />
          </button>
        )}
      </div>
      <figcaption>
        <span className="t">{clip.title}</span>
        <span className="mono muted">
          {clip.channel} · {clip.source}
        </span>
        <a className="sgc-link" href={youtubeWatchUrl(clip)} target="_blank" rel="noopener noreferrer">
          Watch on YouTube ↗
        </a>
      </figcaption>
    </figure>
  );
}
