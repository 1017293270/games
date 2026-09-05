/**
 * Bitmap asset contract.
 *
 * `ART_IDS` mirrors the ID list in `docs/ASSETS.md`, which is the single source
 * of truth shared by content data, the client loader and the `tools/art`
 * pipeline. A test extracts every ID from that document and asserts set
 * equality with this array, so the two can never drift apart.
 *
 * Content data may only reference IDs that appear here.
 */

export const ART_BACKGROUNDS = [
  'bg/cultivation-day',
  'bg/cultivation-night',
  'bg/town-qingyun',
  'bg/map-qingyun-mountain',
  'bg/map-luoshui-city',
  'bg/map-youming-valley',
  'bg/map-kunlun-ruins',
  'bg/dungeon-secret-realm',
  'bg/tribulation',
  'bg/login',
] as const;

export const ART_NPCS = [
  'npc/zhangmen',
  'npc/zhanglao',
  'npc/yaowang',
  'npc/shangren',
  'npc/laozhe',
  'npc/tiejiang',
  'npc/xianzi',
  'npc/zhenshou',
] as const;

export const ART_AVATARS = [
  'avatar/m01',
  'avatar/m02',
  'avatar/m03',
  'avatar/m04',
  'avatar/m05',
  'avatar/m06',
  'avatar/m07',
  'avatar/m08',
  'avatar/f01',
  'avatar/f02',
  'avatar/f03',
  'avatar/f04',
  'avatar/f05',
  'avatar/f06',
  'avatar/f07',
  'avatar/f08',
] as const;

export const ART_MONSTERS = [
  'monster/qingyun-wolf',
  'monster/spirit-ape',
  'monster/luoshui-flood-dragon',
  'monster/river-bandit',
  'monster/ghost-lantern',
  'monster/bone-general',
  'monster/ice-qilin',
  'monster/golden-crow',
] as const;

export const ART_BOSSES = [
  'boss/qingyun-tiger-king',
  'boss/luoshui-dragon-lord',
  'boss/youming-ghost-emperor',
  'boss/kunlun-heaven-beast',
] as const;

export const ART_ITEMS = [
  'item/pill-qi',
  'item/pill-foundation',
  'item/pill-breakthrough',
  'item/pill-heal',
  'item/pill-spirit',
  'item/pill-power',
  'item/pill-golden-core',
  'item/pill-enlightenment',
  'item/mat-spirit-herb',
  'item/mat-iron-essence',
  'item/mat-beast-core',
  'item/mat-spirit-stone',
  'item/mat-jade',
  'item/mat-soul-crystal',
  'item/mat-cloud-silk',
  'item/mat-thunder-wood',
  'item/treasure-sword',
  'item/treasure-bell',
  'item/treasure-fan',
  'item/treasure-seal',
  'item/robe-linen',
  'item/robe-daoist',
  'item/robe-cloud',
  'item/robe-golden',
  'item/acc-jade-pendant',
  'item/acc-prayer-beads',
  'item/acc-talisman',
  'item/pet-crane',
  'item/pet-fox',
  'item/pet-turtle',
] as const;

export const ART_CHARACTERS = [
  'char/meditate-m',
  'char/meditate-f',
] as const;

export const ART_UI = [
  'ui/cloud-pattern',
  'ui/seal-red',
  'ui/scroll-bg',
  'ui/ink-splash',
] as const;

/** Every bitmap ID defined by `docs/ASSETS.md` (82 entries). */
export const ART_IDS = [
  ...ART_BACKGROUNDS,
  ...ART_NPCS,
  ...ART_AVATARS,
  ...ART_CHARACTERS,
  ...ART_MONSTERS,
  ...ART_BOSSES,
  ...ART_ITEMS,
  ...ART_UI,
] as const;

export type ArtId = (typeof ART_IDS)[number];
export type BackgroundArtId = (typeof ART_BACKGROUNDS)[number];
export type NpcArtId = (typeof ART_NPCS)[number];
export type AvatarArtId = (typeof ART_AVATARS)[number];
export type CharacterArtId = (typeof ART_CHARACTERS)[number];
export type MonsterArtId = (typeof ART_MONSTERS)[number];
export type BossArtId = (typeof ART_BOSSES)[number];
export type ItemArtId = (typeof ART_ITEMS)[number];
export type UiArtId = (typeof ART_UI)[number];

const ART_ID_SET: ReadonlySet<string> = new Set<string>(ART_IDS);

/** Narrows an arbitrary string to a known art ID. */
export function isArtId(value: string): value is ArtId {
  return ART_ID_SET.has(value);
}

/**
 * Shape of `apps/client/public/art/manifest.json`, produced by `tools/art`
 * and fetched once by the client at boot.
 */
export interface ArtManifestEntry {
  src: string;
  /** Backgrounds only: 720px short-edge variant. */
  srcSmall?: string;
  w: number;
  h: number;
  alpha: boolean;
}

export interface ArtManifest {
  version: number;
  generatedAt: string;
  assets: Partial<Record<ArtId, ArtManifestEntry>>;
}
