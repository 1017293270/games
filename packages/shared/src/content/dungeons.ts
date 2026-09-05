/**
 * 秘境副本. Four instances, one BOSS each, tuned for a party of up to four.
 * A run is two trash waves drawn from the matching overworld map followed by
 * the BOSS; the server resolves each wave through `simulateBattle` and streams
 * the results back as a replay.
 */

import { indexById } from '../core/util.js';
import { DungeonSchema, type Dungeon } from '../domain/map.js';

const SPECS: Dungeon[] = [
  {
    id: 'dungeon-qingyun',
    name: '青云秘境',
    description: '青云山腹中的洞天，灵光自石壁裂隙渗出。虎王盘踞其深处已逾百年。',
    art: 'bg/dungeon-secret-realm',
    unlockStage: 4,
    recommendedStage: 6,
    waves: [
      ['monster-qingyun-wolf', 'monster-qingyun-wolf'],
      ['monster-spirit-ape', 'monster-qingyun-wolf'],
    ],
    bossId: 'boss-qingyun-tiger-king',
    partySize: 2,
    reward: {
      exp: 20000,
      spiritStones: 3000,
      loot: [
        { itemId: 'mat-beast-core', chance: 1, min: 2, max: 5 },
        { itemId: 'pill-foundation', chance: 0.5, min: 1, max: 2 },
      ],
    },
    bonusDailyEntries: 0,
  },
  {
    id: 'dungeon-luoshui',
    name: '洛水秘境',
    description: '洛水河底的龙宫遗址，水幕如壁，其中藏着龙君的私库。',
    art: 'bg/dungeon-secret-realm',
    unlockStage: 8,
    recommendedStage: 10,
    waves: [
      ['monster-river-bandit', 'monster-river-bandit'],
      ['monster-luoshui-flood-dragon', 'monster-river-bandit'],
    ],
    bossId: 'boss-luoshui-dragon-lord',
    partySize: 3,
    reward: {
      exp: 260000,
      spiritStones: 12000,
      loot: [
        { itemId: 'mat-cloud-silk', chance: 1, min: 2, max: 5 },
        { itemId: 'pill-breakthrough', chance: 0.4, min: 1, max: 1 },
      ],
    },
    bonusDailyEntries: 0,
  },
  {
    id: 'dungeon-youming',
    name: '幽冥秘境',
    description: '幽冥谷底的鬼帝旧殿，白骨铺阶，殿门终年虚掩。',
    art: 'bg/dungeon-secret-realm',
    unlockStage: 12,
    recommendedStage: 14,
    waves: [
      ['monster-ghost-lantern', 'monster-ghost-lantern'],
      ['monster-bone-general', 'monster-ghost-lantern'],
    ],
    bossId: 'boss-youming-ghost-emperor',
    partySize: 4,
    reward: {
      exp: 2400000,
      spiritStones: 48000,
      loot: [
        { itemId: 'mat-soul-crystal', chance: 1, min: 3, max: 8 },
        { itemId: 'pill-golden-core', chance: 0.35, min: 1, max: 1 },
      ],
    },
    bonusDailyEntries: 0,
  },
  {
    id: 'dungeon-kunlun',
    name: '昆仑秘境',
    description: '昆仑墟下的上古战场，断兵成堆。九首天兽仍在守着那道封印。',
    art: 'bg/dungeon-secret-realm',
    unlockStage: 16,
    recommendedStage: 18,
    waves: [
      ['monster-ice-qilin', 'monster-golden-crow'],
      ['monster-golden-crow', 'monster-ice-qilin', 'monster-ice-qilin'],
    ],
    bossId: 'boss-kunlun-heaven-beast',
    partySize: 4,
    reward: {
      exp: 20000000,
      spiritStones: 160000,
      loot: [
        { itemId: 'mat-thunder-wood', chance: 1, min: 3, max: 6 },
        { itemId: 'pill-enlightenment', chance: 0.3, min: 1, max: 1 },
      ],
    },
    bonusDailyEntries: 0,
  },
];

export const DUNGEONS: readonly Dungeon[] = SPECS.map((d) => DungeonSchema.parse(d));
export const DUNGEON_BY_ID: ReadonlyMap<string, Dungeon> = indexById(DUNGEONS);
export const DUNGEON_IDS: readonly string[] = DUNGEONS.map((d) => d.id);

export function dungeonsAvailableAt(stageIndex: number): readonly Dungeon[] {
  return DUNGEONS.filter((d) => d.unlockStage <= stageIndex);
}
