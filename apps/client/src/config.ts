/**
 * Client-wide constants.
 *
 * Deliberately dependency-free: `vite.config.ts` imports this file to build the
 * PWA manifest, so it must not pull in anything browser- or React-specific.
 */

/** Displayed everywhere the game names itself: title bar, PWA manifest, login. */
export const GAME_NAME = '青云问道';

export const GAME_TAGLINE = '一炉丹火 半世逍遥';

export const GAME_DESCRIPTION = '水墨放置修仙：离线也在修炼，上线处理突破、探索、论道与秘境。';

/** Portrait design baseline. The playfield never grows past this width. */
export const FRAME_MAX_WIDTH = 480;

/** Ink-wash palette, mirrored from `src/design/tokens.css`. */
export const COLORS = {
  paper: '#F3EBDC',
  ink: '#1E1B18',
  inkSoft: '#5C5650',
  cinnabar: '#B23A2E',
  indigo: '#3B5F6B',
  gold: '#C9A063',
} as const;

/** Self-hosted calligraphic display face, subset by `scripts/subset-font.mjs`. */
export const DISPLAY_FONT_URL = '/fonts/mashanzheng-subset.woff2';

/** Where the art pipeline drops its manifest. */
export const ART_MANIFEST_URL = '/art/manifest.json';

/** Local hours counted as daytime for the cultivation backdrop. */
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 18;

/** Re-settle cultivation with the server at most this often. */
export const SETTLE_INTERVAL_MS = 30_000;

/** Cap on ambient qi particles; halved on coarse pointers, zeroed by reduced motion. */
export const MAX_QI_PARTICLES = 60;
