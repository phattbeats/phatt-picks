/**
 * Minimal stroke padlock (PHA-1016). Replaces the 🔒 emoji across lock
 * surfaces — tab chips, locked-stage cards, reveal-gate notes — so the lock
 * treatment reads as part of the tactical UI rather than a phone keyboard.
 * Inherits `currentColor`; size in px.
 */
export function LockIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "-0.08em" }}
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}
