import { getProgression, progressionBonuses } from '../src/progression/index.js';
import { describe, expect, it } from 'vitest';
import {
  cultivationRatePerSec,
  secondsToNextStage,
  settleCultivation,
} from '../src/cultivation/settle.js';
import { expRequired, getStage, stageDurationSec } from '../src/cultivation/realms.js';
import { DEFAULT_WORLD_SETTINGS } from '../src/domain/world.js';
import { TECHNIQUE_BY_ID } from '../src/content/techniques.js';
import type { CharacterState } from '../src/domain/character.js';

const T0 = 1_700_000_000_000;

function makeChar(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    id: 'c1',
    userId: 'u1',
    name: 'testdao',
    gender: 'male',
    avatarArt: 'avatar/m01',
    isBot: false,
    botArchetypeId: null,
    botParams: null,
    spiritRoot: { element: 'fire', quality: 'mortal' },
    stageIndex: 0,
    exp: 0,
    spiritStones: 0,
    skillSlots: [null, null, null, null],
    learnedSkillIds: [],
    techniqueId: null,
    learnedTechniqueIds: [],
    equipment: { treasure: null, robe: null, accessory: null, pet: null },
    buffs: [],
    hpPercent: 1,
    protectedUntil: 0,
    chapter: 1,
    quests: [],
    flags: {},
    lastSettledAt: T0,
    lastSeenAt: T0,
    createdAt: T0,
    dailyCounters: { date: '2023-11-14', dungeon: 0, arena: 0, gatherAt: {} },
    arenaRating: 1000,
    arenaWins: 0,
    arenaLosses: 0,
    prestige: 0,
    powerScore: 0,
    ...overrides,
  };
}

const world = DEFAULT_WORLD_SETTINGS;

describe('cultivation rate', () => {
  it('multiplies base rate by root quality, technique, pill and world multiplier', () => {
    const base = getStage(0).baseRatePerSec;
    expect(
      cultivationRatePerSec({
        stageIndex: 0,
        spiritRootQuality: 'mortal',
        world: { cultivationMultiplier: 1 },
      }),
    ).toBeCloseTo(base, 9);

    expect(
      cultivationRatePerSec({
        stageIndex: 0,
        spiritRootQuality: 'heaven',
        techniqueBonus: 0.5,
        pillBonus: 0.3,
        world: { cultivationMultiplier: 2 },
      }),
    ).toBeCloseTo(base * 1.8 * 1.5 * 1.3 * 2, 9);
  });

  it('applies 异灵根 1.3 and 天灵根 1.8', () => {
    const at = (q: 'mortal' | 'rare' | 'heaven') =>
      cultivationRatePerSec({
        stageIndex: 5,
        spiritRootQuality: q,
        world: { cultivationMultiplier: 1 },
      });
    expect(at('rare') / at('mortal')).toBeCloseTo(1.3, 9);
    expect(at('heaven') / at('mortal')).toBeCloseTo(1.8, 9);
  });
});

describe('lazy settlement', () => {
  it('credits exactly rate x elapsed inside one stage', () => {
    const char = makeChar();
    const result = settleCultivation(char, T0 + 60_000, world);
    expect(result.elapsedSec).toBe(60);
    expect(result.creditedSec).toBe(60);
    expect(result.forfeitedSec).toBe(0);
    expect(result.gainedExp).toBeCloseTo(60 * getStage(0).baseRatePerSec, 6);
    expect(result.character.exp).toBeCloseTo(result.gainedExp, 6);
    expect(result.character.stageIndex).toBe(0);
    expect(result.character.lastSettledAt).toBe(T0 + 60_000);
  });

  it('never mutates the input character', () => {
    const char = makeChar();
    settleCultivation(char, T0 + 3_600_000, world);
    expect(char.exp).toBe(0);
    expect(char.stageIndex).toBe(0);
    expect(char.lastSettledAt).toBe(T0);
  });

  it('treats a clock that went backwards as zero elapsed', () => {
    const char = makeChar();
    const result = settleCultivation(char, T0 - 5_000, world);
    expect(result.elapsedSec).toBe(0);
    expect(result.gainedExp).toBe(0);
  });

  it('auto-advances 小境界 前期 -> 中期 -> 后期 -> 圆满', () => {
    const char = makeChar();
    // Enough time to clear 练气 前期+中期+后期 exactly.
    // Timestamps are whole milliseconds, as they are in production.
    const ms = Math.ceil((stageDurationSec(0) + stageDurationSec(1) + stageDurationSec(2)) * 1000);
    const result = settleCultivation(char, T0 + ms, world);
    expect(result.character.stageIndex).toBe(3); // 练气·圆满
    expect(result.stageUps).toBe(3);
    // Only the sub-millisecond rounding-up spills into the new stage.
    expect(result.character.exp / expRequired(3)).toBeLessThan(1e-4);
  });

  it('parks at 圆满 and never crosses a 大境界 on its own', () => {
    const char = makeChar();
    // A full year of cultivation must still stop at 练气·圆满.
    const result = settleCultivation(char, T0 + 365 * 86400 * 1000, {
      cultivationMultiplier: 1,
      offlineCapHours: 24 * 365,
    });
    expect(result.character.stageIndex).toBe(3);
    expect(result.character.exp).toBe(expRequired(3));
    expect(result.atPerfection).toBe(true);
    expect(result.wastedSec).toBeGreaterThan(0);
  });

  it('does not overflow exp past the stage requirement at 圆满', () => {
    const char = makeChar({ stageIndex: 3, exp: expRequired(3) - 1 });
    const result = settleCultivation(char, T0 + 86400_000, world);
    expect(result.character.exp).toBe(expRequired(3));
    expect(result.character.stageIndex).toBe(3);
  });

  it('caps offline time at world.offlineCapHours and forfeits the rest', () => {
    const char = makeChar();
    const threeDays = 3 * 86400 * 1000;
    const result = settleCultivation(char, T0 + threeDays, {
      cultivationMultiplier: 1,
      offlineCapHours: 12,
    });
    expect(result.elapsedSec).toBe(3 * 86400);
    expect(result.creditedSec).toBe(12 * 3600);
    expect(result.forfeitedSec).toBe(3 * 86400 - 12 * 3600);
    // Still advances lastSettledAt to now: the forfeited window is gone.
    expect(result.character.lastSettledAt).toBe(T0 + threeDays);
  });

  it('honours a zero offline cap', () => {
    const char = makeChar();
    const result = settleCultivation(char, T0 + 86400_000, {
      cultivationMultiplier: 1,
      offlineCapHours: 0,
    });
    expect(result.creditedSec).toBe(0);
    expect(result.gainedExp).toBe(0);
    expect(result.character.lastSettledAt).toBe(T0 + 86400_000);
  });

  it('respects the world cultivation multiplier', () => {
    const char = makeChar();
    const slow = settleCultivation(char, T0 + 60_000, {
      cultivationMultiplier: 1,
      offlineCapHours: 12,
    });
    const fast = settleCultivation(char, T0 + 60_000, {
      cultivationMultiplier: 3,
      offlineCapHours: 12,
    });
    expect(fast.gainedExp / slow.gainedExp).toBeCloseTo(3, 6);
  });

  it('applies a technique bonus', () => {
    const char = makeChar({ techniqueId: 'tech-tuna' });
    const technique = TECHNIQUE_BY_ID.get('tech-tuna');
    const plain = settleCultivation(char, T0 + 60_000, world);
    const boosted = settleCultivation(char, T0 + 60_000, world, { technique });
    expect(boosted.gainedExp / plain.gainedExp).toBeCloseTo(1.25, 6);
  });

  it('stops applying a pill buff once it expires mid-window', () => {
    // 60s window; the +100% buff covers only the first 30s.
    const char = makeChar({
      buffs: [{ id: 'b1', itemId: 'pill-qi', bonus: 1.0, expiresAt: T0 + 30_000 }],
    });
    const result = settleCultivation(char, T0 + 60_000, world);
    const base = getStage(0).baseRatePerSec;
    // 30s at 2x + 30s at 1x
    expect(result.gainedExp).toBeCloseTo(30 * base * 2 + 30 * base, 6);
    // The expired buff is pruned from the returned record.
    expect(result.character.buffs).toHaveLength(0);
  });

  it('keeps a buff that is still live at the end of the window', () => {
    const char = makeChar({
      buffs: [{ id: 'b1', itemId: 'pill-qi', bonus: 0.5, expiresAt: T0 + 900_000 }],
    });
    const result = settleCultivation(char, T0 + 60_000, world);
    expect(result.gainedExp).toBeCloseTo(60 * getStage(0).baseRatePerSec * 1.5, 6);
    expect(result.character.buffs).toHaveLength(1);
  });

  it('drops a buff that expired entirely inside the forfeited window', () => {
    const char = makeChar({
      buffs: [{ id: 'b1', itemId: 'pill-qi', bonus: 5, expiresAt: T0 + 3600_000 }],
    });
    // 3 days elapsed, 12h credited -> the credited window starts long after the
    // buff expired, so it must contribute nothing.
    const result = settleCultivation(char, T0 + 3 * 86400_000, {
      cultivationMultiplier: 1,
      offlineCapHours: 12,
    });
    const stage = getStage(result.character.stageIndex);
    expect(stage.stageIndex).toBe(3);
    expect(result.character.buffs).toHaveLength(0);
  });

  it('scales a bot by talent x (1 + insight)', () => {
    const human = makeChar();
    const bot = makeChar({
      isBot: true,
      botArchetypeId: 'bot-tianjiao',
      botParams: {
        talent: 2.5,
        diligence: 0.9,
        insight: 0.15,
        aggression: 0.3,
        activeHours: [8, 24],
        explorePref: 'dungeon',
      },
    });
    const h = settleCultivation(human, T0 + 60_000, world);
    const b = settleCultivation(bot, T0 + 60_000, world);
    expect(b.gainedExp / h.gainedExp).toBeCloseTo(2.5 * 1.15, 6);
  });

  it('reports the stages crossed', () => {
    const char = makeChar();
    const seconds = stageDurationSec(0) + stageDurationSec(1) / 2;
    const result = settleCultivation(char, T0 + seconds * 1000, world);
    expect(result.fromStageIndex).toBe(0);
    expect(result.character.stageIndex).toBe(1);
    expect(result.stageUps).toBe(1);
  });
});

describe('secondsToNextStage', () => {
  it('matches the stage duration for a fresh character', () => {
    const char = makeChar();
    expect(secondsToNextStage(char, world)).toBeCloseTo(stageDurationSec(0), 6);
  });

  it('returns 0 when the stage is already full', () => {
    const char = makeChar({ stageIndex: 3, exp: expRequired(3) });
    expect(secondsToNextStage(char, world)).toBe(0);
  });

  it('shortens with a better spirit root', () => {
    const mortal = makeChar();
    const heaven = makeChar({ spiritRoot: { element: 'fire', quality: 'heaven' } });
    expect(secondsToNextStage(heaven, world)).toBeCloseTo(
      secondsToNextStage(mortal, world) / 1.8,
      6,
    );
  });
});

it('collected relic cultivation bonus increases actual offline gains and reduces ETA', () => {
  const progression = getProgression(undefined, T0);
  progression.relics = [{ definitionId: 'r-spirit-5', spiritLevel: 3, stars: 2, fragments: 0 }];
  const plain = makeChar(),
    enhanced = makeChar({ progression });
  const a = settleCultivation(plain, T0 + 60000, world),
    b = settleCultivation(enhanced, T0 + 60000, world);
  expect(b.gainedExp / a.gainedExp).toBeCloseTo(
    1 + progressionBonuses(progression).cultivationBonus,
  );
  expect(secondsToNextStage(enhanced, world)).toBeLessThan(secondsToNextStage(plain, world));
});
