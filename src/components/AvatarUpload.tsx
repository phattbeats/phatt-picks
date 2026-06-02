"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Profile-picture control for the identity card. Renders the current avatar (or
 * initials) and, when `editable`, lets the player pick an image that's cropped
 * to a centered square and downscaled to {@link SIZE}px on a canvas before
 * upload — so the stored data URL stays tiny regardless of the source file.
 */
const SIZE = 160; // stored square edge, in px
const QUALITY = 0.82;

export function AvatarUpload({
  initials,
  initialAvatarUrl,
  editable,
}: {
  initials: string;
  initialAvatarUrl: string | null;
  editable: boolean;
}) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await resizeToSquare(file);
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Upload failed");
      setAvatarUrl(dataUrl);
      router.refresh(); // update the top-bar avatar + anywhere else it shows
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        onClick={() => editable && inputRef.current?.click()}
        disabled={!editable || busy}
        aria-label={editable ? "Change profile picture" : undefined}
        style={{
          position: "relative",
          width: 56,
          height: 56,
          padding: 0,
          border: "1px solid var(--hair-3)",
          background: avatarUrl
            ? "var(--surf-2)"
            : "linear-gradient(135deg, var(--surf-3), var(--surf-2))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          flexShrink: 0,
          cursor: editable && !busy ? "pointer" : "default",
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 22,
          color: "var(--ink-hi)",
        }}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span>{initials}</span>
        )}

        {editable && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              bottom: 0,
              right: 0,
              width: 20,
              height: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--heat)",
              color: "var(--void)",
              borderTopLeftRadius: 4,
            }}
          >
            {busy ? (
              <span
                style={{
                  width: 10,
                  height: 10,
                  border: "2px solid var(--void)",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "av-spin 0.7s linear infinite",
                }}
              />
            ) : (
              <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </span>
        )}
      </button>

      {editable && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: busy ? "default" : "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: error ? "var(--ember)" : "var(--ink-low)",
          }}
        >
          {busy ? "Saving…" : error ? error : avatarUrl ? "Change photo" : "Add photo"}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        style={{ display: "none" }}
      />

      <style>{`@keyframes av-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/** Read a file, center-crop to a square, downscale to SIZE, return a JPEG data URL. */
function resizeToSquare(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like an image"));
      img.onload = () => {
        const edge = Math.min(img.width, img.height);
        const sx = (img.width - edge) / 2;
        const sy = (img.height - edge) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable"));
        ctx.drawImage(img, sx, sy, edge, edge, 0, 0, SIZE, SIZE);
        resolve(canvas.toDataURL("image/jpeg", QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
