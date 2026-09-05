import { hashSeed } from '@xianxia/shared';

/**
 * Stand-in artwork.
 *
 * `docs/ASSETS.md` requires that a missing bitmap never blanks or breaks a
 * screen, and the art pipeline runs on its own schedule — so every picture slot
 * draws one of these instead: paper ground, a light ink motif matched to what
 * the slot will eventually hold, and the subject's name.
 *
 * Two details matter. The caption is HTML, not SVG text, so it stays 11px in a
 * 40px avatar and in a full-bleed background rather than scaling with the box.
 * And the geometry is jittered from a hash of the asset id, so a list of four
 * maps or eight portraits does not read as the same drawing repeated.
 */
export type Motif = 'scene' | 'portrait' | 'figure' | 'beast' | 'token';

export interface ArtPlaceholderProps {
  /** Printed under the motif. Pass '' on slots too small to read a caption. */
  label?: string;
  motif?: Motif;
  /** Stable per-asset variation source; normally the art id. */
  seed?: string;
  /** Skip the paper ground for slots whose real asset has an alpha channel. */
  transparent?: boolean;
  className?: string;
}

const INK_FILL = 'rgba(30,27,24,0.06)';
const INK_LINE = 'rgba(30,27,24,0.26)';
const INK_SOFT = 'rgba(30,27,24,0.16)';

/** Far ridge, near ridge, a band of cloud between them. */
function drawScene(n: (max: number) => number) {
  const near = 30 + n(14);
  const far = 58 + n(16);
  const cloudY = 26 + n(10);
  return (
    <>
      <path
        d={`M-6 84 ${far - 14} 40l10 12 12-17 ${106 - far} 49z`}
        fill="rgba(30,27,24,0.045)"
        stroke={INK_SOFT}
        strokeWidth="1"
      />
      <path
        d={`M-6 96 ${near} 52l14 17 11-13 ${100 - near} 40z`}
        fill={INK_FILL}
        stroke={INK_LINE}
        strokeWidth="1"
      />
      <path
        d={`M6 ${cloudY}c5-5 12-5 16 1 5-7 16-7 21 1 5-6 13-5 17 1`}
        stroke={INK_SOFT}
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d={`M${58 + n(14)} ${cloudY - 12}c4-4 10-4 12 1`}
        stroke="rgba(59,95,107,0.32)"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </>
  );
}

function drawPortrait(n: (max: number) => number) {
  const r = 12 + n(4);
  const spread = 24 + n(6);
  return (
    <>
      <circle cx="50" cy="40" r={r} fill={INK_FILL} stroke={INK_LINE} strokeWidth="0.9" />
      <path
        d={`M${50 - spread} 86c2-16 12-25 ${spread} -25s${spread - 2} 9 ${spread} 25`}
        fill={INK_FILL}
        stroke={INK_LINE}
        strokeWidth="0.9"
      />
      <path d={`M${50 - r - 2} 32c${r} -10 ${r + 4} -10 ${2 * r + 4} 0`} stroke={INK_SOFT} strokeWidth="0.9" />
    </>
  );
}

/** A cultivator seated in meditation — used where the real art is a cut-out. */
function drawFigure(n: (max: number) => number) {
  const tilt = n(3) - 1;
  const x = 50 + tilt;
  return (
    <>
      <circle cx={x} cy="24" r="8.5" fill={INK_FILL} stroke={INK_LINE} strokeWidth="1" />
      {/* Robe: rounded shoulders falling into a bell over crossed legs. */}
      <path
        d={`M${x} 33c-9 0-14 6-16 15-2 10-6 19-12 26-3 3-2 6 2 6h52c4 0 5-3 2-6-6-7-10-16-12-26-2-9-7-15-16-15z`}
        fill={INK_FILL}
        stroke={INK_LINE}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Hands folded in the lap. */}
      <path d={`M${x - 9} 66c4-4 14-4 18 0`} stroke={INK_LINE} strokeWidth="1" strokeLinecap="round" />
      {/* Sash. */}
      <path d={`M${x - 15} 52c9 3 21 3 30 0`} stroke={INK_SOFT} strokeWidth="1" strokeLinecap="round" />
    </>
  );
}

/** A crouching beast: haunch, lowered head, one ear, a lashing tail. */
function drawBeast(n: (max: number) => number) {
  const haunch = 44 + n(8);
  const headX = 30 - n(6);
  return (
    <>
      <path
        d={`M20 82c0-16 8-28 22-32 8-2 16-2 24 1 12 5 18 16 18 31z`}
        fill={INK_FILL}
        stroke={INK_LINE}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d={`M${headX} 50c-8 1-13 6-13 13 0 6 5 10 12 10 6 0 10-4 11-9`}
        fill={INK_FILL}
        stroke={INK_LINE}
        strokeWidth="1"
      />
      <path d={`M${headX - 2} 50 ${headX - 6} 38l10 6`} stroke={INK_LINE} strokeWidth="1" strokeLinejoin="round" />
      <path d={`M84 ${haunch}c9-6 12-16 9-25`} stroke={INK_LINE} strokeWidth="1" strokeLinecap="round" />
      <circle cx={headX + 4} cy="60" r="1.8" fill="rgba(178,58,46,0.75)" />
    </>
  );
}

function drawToken(n: (max: number) => number) {
  const shape = n(3);
  const body =
    shape === 0 ? (
      <circle cx="50" cy="48" r="21" fill={INK_FILL} stroke={INK_LINE} strokeWidth="0.9" />
    ) : shape === 1 ? (
      <path
        d="M50 25 73 48 50 71 27 48z"
        fill={INK_FILL}
        stroke={INK_LINE}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
    ) : (
      <path
        d="M38 24h24a4 4 0 0 1 4 4v40a4 4 0 0 1-4 4H38a4 4 0 0 1-4-4V28a4 4 0 0 1 4-4z"
        fill={INK_FILL}
        stroke={INK_LINE}
        strokeWidth="0.9"
      />
    );
  return (
    <>
      {body}
      <path
        d={`M${41 + n(3)} 46c4-8 15-8 19 0`}
        stroke="rgba(201,160,99,0.8)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </>
  );
}

const DRAW: Record<Motif, (n: (max: number) => number) => React.ReactNode> = {
  scene: drawScene,
  portrait: drawPortrait,
  figure: drawFigure,
  beast: drawBeast,
  token: drawToken,
};

export function ArtPlaceholder({
  label,
  motif = 'scene',
  seed,
  transparent = false,
  className = '',
}: ArtPlaceholderProps) {
  // One hash, consumed digit by digit, keeps the variation stable per asset.
  let state = hashSeed(seed ?? label ?? motif);
  const pick = (max: number): number => {
    state = (state * 1103515245 + 12345) >>> 0;
    return max <= 0 ? 0 : state % max;
  };

  return (
    <div
      className={`placeholder ${transparent ? 'placeholder--bare' : ''} ${className}`}
      role="img"
      aria-label={label ? `${label}（图稿待补）` : '图稿待补'}
    >
      <svg
        className="placeholder__art"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {!transparent && <rect width="100" height="100" fill="var(--paper-sunk)" />}
        <g fill="none">{DRAW[motif](pick)}</g>
      </svg>
      {label ? <span className="placeholder__label">{label}</span> : null}
    </div>
  );
}
