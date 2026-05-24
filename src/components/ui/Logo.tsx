/** Swiss bracket logo + wordmark lockup. See LOGO-IMPLEMENTATION.md. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <a href="/" className="flex items-center gap-3 no-underline text-inherit">
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0 }}
      >
        <line x1="6" y1="10" x2="12" y2="10" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="16" x2="12" y2="16" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="24" x2="12" y2="24" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="30" x2="12" y2="30" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="13" x2="18" y2="13" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="27" x2="18" y2="27" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <line x1="18" y1="20" x2="24" y2="20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="26" cy="20" r="3" fill="#ef4444" />
        <line x1="28" y1="20" x2="34" y2="20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span
        style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: "1.25rem",
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          color: "var(--text-hi)",
        }}
      >
        phaTT Picks
      </span>
    </a>
  );
}
