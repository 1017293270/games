import type { ReactElement } from 'react';

/**
 * Interface glyphs. Every one is a brush stroke rather than a UI pictogram, so
 * the tab bar reads as part of the painting instead of a toolbar bolted on.
 * Bitmap art is reserved for the picture slots defined in `docs/ASSETS.md`.
 */
export type GlyphName = 'cultivate' | 'explore' | 'realm' | 'social' | 'self';

const paths: Record<GlyphName, ReactElement> = {
  // 周天: a body seated inside a turning circuit.
  cultivate: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 9.4a2.1 2.1 0 1 0 0-.02" />
      <path d="M7.9 16.4c1-2.2 2.4-3.3 4.1-3.3s3.1 1.1 4.1 3.3" />
    </>
  ),
  // 山: peaks and a trail.
  explore: (
    <>
      <path d="M2.6 18.2 9 7.6l4 6.2 2.3-3.2 6.1 7.6z" />
      <path d="M9 7.6 6.4 12h4.4" />
    </>
  ),
  // 洞天: a gate cut into rock.
  realm: (
    <>
      <path d="M4.5 19.5V11a7.5 7.5 0 0 1 15 0v8.5" />
      <path d="M9.6 19.5v-8a2.4 2.4 0 0 1 4.8 0v8" />
      <path d="M2.8 19.5h18.4" />
    </>
  ),
  // 两人相对.
  social: (
    <>
      <circle cx="8.4" cy="8.6" r="2.7" />
      <circle cx="16.2" cy="10.2" r="2.2" />
      <path d="M3.4 19.4c0-2.9 2.2-5 5-5s5 2.1 5 5" />
      <path d="M13.9 19.4c.3-2.3 1.9-3.7 4-3.7 1.4 0 2.4.5 3.1 1.3" />
    </>
  ),
  // 己: a bust framed by a scroll edge.
  self: (
    <>
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5.2 19.6c0-3.7 3-6.2 6.8-6.2s6.8 2.5 6.8 6.2" />
      <path d="M3.4 4.4h17.2" />
    </>
  ),
};

export function Glyph({ name, size = 22 }: { name: GlyphName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** 灵石 mark used beside every stone readout. */
export function StoneMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" fill="none">
      <path
        d="M6 1.1 10.5 6 6 10.9 1.5 6z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M3.6 6h4.8" stroke="currentColor" strokeWidth="0.7" opacity="0.6" />
    </svg>
  );
}

export function ChevronRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m6 3.5 4.5 4.5L6 12.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
