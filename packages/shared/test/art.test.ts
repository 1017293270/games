import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ART_AVATARS,
  ART_BACKGROUNDS,
  ART_BOSSES,
  ART_CHARACTERS,
  ART_IDS,
  ART_ITEMS,
  ART_MONSTERS,
  ART_NPCS,
  ART_SPRITES,
  ART_UI,
  ART_ZONES,
  isArtId,
} from '../src/core/art.js';
import { referencedArtIds } from '../src/content/registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS_MD = resolve(HERE, '../../../docs/ASSETS.md');

/**
 * Pulls every bitmap ID out of `docs/ASSETS.md`.
 *
 * The lookbehind rejects IDs that are part of a file path (`/art/bg/x.webp`)
 * and the trailing guard rejects a bare category heading (`` `item/` ``), so
 * only real IDs match — in tables, in prose lists and in the manifest example.
 */
const ID_PATTERN =
  /(?<![\w/-])(?:bg|npc|avatar|char|monster|boss|item|ui|zone|sprite)\/[a-z0-9]+(?:-[a-z0-9]+)*(?![\w-])/g;

function idsFromAssetsDoc(): string[] {
  const markdown = readFileSync(ASSETS_MD, 'utf8');
  return [...new Set(markdown.match(ID_PATTERN) ?? [])];
}

describe('ART_IDS mirrors docs/ASSETS.md', () => {
  const documented = idsFromAssetsDoc();

  it('finds the documented 98 IDs in the contract file', () => {
    expect(documented).toHaveLength(98);
  });

  it('is exactly the same set as ART_IDS', () => {
    // Compared as sorted arrays: the manifest example at the top of the
    // document repeats two IDs out of section order, so document order is not
    // meaningful — set equality is what the contract requires.
    expect([...ART_IDS].sort()).toEqual([...documented].sort());
  });

  it('has no duplicates', () => {
    expect(new Set(ART_IDS).size).toBe(ART_IDS.length);
  });

  it('splits into the documented category counts', () => {
    expect(ART_BACKGROUNDS).toHaveLength(10);
    expect(ART_NPCS).toHaveLength(8);
    expect(ART_AVATARS).toHaveLength(16);
    expect(ART_MONSTERS).toHaveLength(8);
    expect(ART_BOSSES).toHaveLength(4);
    expect(ART_ITEMS).toHaveLength(30);
    expect(ART_CHARACTERS).toHaveLength(2);
    expect(ART_UI).toHaveLength(4);
    expect(ART_ZONES).toHaveLength(4);
    expect(ART_SPRITES).toHaveLength(12);
    expect(ART_IDS).toHaveLength(98);
  });

  it('keeps every ID inside its declared prefix', () => {
    const groups: [readonly string[], string][] = [
      [ART_BACKGROUNDS, 'bg/'],
      [ART_NPCS, 'npc/'],
      [ART_AVATARS, 'avatar/'],
      [ART_CHARACTERS, 'char/'],
      [ART_MONSTERS, 'monster/'],
      [ART_BOSSES, 'boss/'],
      [ART_ITEMS, 'item/'],
      [ART_UI, 'ui/'],
      [ART_ZONES, 'zone/'],
      [ART_SPRITES, 'sprite/'],
    ];
    for (const [ids, prefix] of groups) {
      for (const id of ids) expect(id.startsWith(prefix)).toBe(true);
    }
  });

  it('narrows known IDs and rejects unknown ones', () => {
    expect(isArtId('bg/login')).toBe(true);
    expect(isArtId('item/pill-qi')).toBe(true);
    expect(isArtId('bg/does-not-exist')).toBe(false);
    expect(isArtId('')).toBe(false);
    expect(isArtId('art/manifest.json')).toBe(false);
  });
});

describe('content only references contract art', () => {
  it('resolves every art id used by the content tables', () => {
    const referenced = referencedArtIds();
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) expect(isArtId(id)).toBe(true);
  });

  it('uses every npc, monster, boss and item portrait', () => {
    const referenced = new Set(referencedArtIds());
    for (const id of [...ART_NPCS, ...ART_MONSTERS, ...ART_BOSSES, ...ART_ITEMS]) {
      expect(referenced.has(id)).toBe(true);
    }
  });

  it('uses every zone floor and 妖兽 sprite', () => {
    const referenced = new Set(referencedArtIds());
    for (const id of [...ART_ZONES, ...ART_SPRITES]) expect(referenced.has(id)).toBe(true);
  });
});
