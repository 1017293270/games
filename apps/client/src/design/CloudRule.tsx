/**
 * 祥云 divider. Hand-drawn rather than a plain `<hr>` because it also carries
 * the section break in a screen with no chrome to speak of.
 */
export function CloudRule({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`cloud-rule ${className}`}
      viewBox="0 0 320 12"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <path d="M0 6h116" stroke="currentColor" strokeWidth="1" />
      <path d="M204 6h116" stroke="currentColor" strokeWidth="1" />
      <path
        d="M124 6c4-4 10-4 13 0 3-5 11-5 14 1 3-6 12-6 15 0 3-5 10-5 13-1 3-4 9-4 13 0"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <circle cx="160" cy="10" r="1.1" fill="currentColor" />
    </svg>
  );
}
