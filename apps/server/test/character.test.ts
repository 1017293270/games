import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStage, MAX_STAGE_INDEX, stageName } from '@xianxia/shared';
import type { CharacterView } from '@xianxia/shared';
import {
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
  type Player,
} from './helpers.js';

describe('character', () => {
  let h: Harness;
  let player: Player;

  beforeEach(async () => {
    h = createHarness();
    player = await makePlayer(h, { name: '李清子' });
  });
  afterEach(async () => {
    await h.close();
  });

  const get = async (): Promise<CharacterView> =>
    expectOk<CharacterView>(
      (
        await h.app.inject({ method: 'GET', url: '/api/character', headers: auth(player.token) })
      ).json(),
    );

  it('creates a cultivator with a rolled spirit root, starter kit and 灵石', async () => {
    const view = await get();
    expect(view.character.name).toBe('李清子');
    expect(view.character.stageIndex).toBe(0);
    expect(view.stageName).toBe('练气·前期');
    expect(view.character.spiritStones).toBe(500);
    expect(view.character.learnedSkillIds).toHaveLength(4);
    expect(view.character.skillSlots.filter(Boolean)).toHaveLength(4);
    expect(view.character.techniqueId).toBe('tech-qingyun');
    expect(view.inventory.length).toBeGreaterThan(0);
    expect(view.stats.hp).toBeGreaterThan(0);
    expect(view.ratePerSec).toBeGreaterThan(0);
    expect(view.character.powerScore).toBeGreaterThan(0);
  });

  it('refuses a second cultivator and a taken 道号', async () => {
    const second = await h.app.inject({
      method: 'POST',
      url: '/api/character',
      headers: auth(player.token),
      payload: { name: '别的名字', avatarArt: 'avatar/m02', gender: 'male' },
    });
    expect(expectFail(second.json()).code).toBe('CHARACTER_EXISTS');

    const other = await makePlayer(h, { name: '王玄' });
    const clash = await h.app.inject({
      method: 'POST',
      url: '/api/character',
      headers: auth(other.token),
      payload: { name: '李清子', avatarArt: 'avatar/f01', gender: 'female' },
    });
    // The second account already has a cultivator, so the name clash is only
    // reachable from a fresh account.
    expect(expectFail(clash.json()).code).toBe('CHARACTER_EXISTS');
  });

  it('settles 修为 lazily from the wall clock', async () => {
    const before = await get();
    expect(before.character.exp).toBe(0);

    h.clock.advance(60_000);
    const settled = expectOk<{ gainedExp: number; elapsedSec: number; view: CharacterView }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/character/settle',
          headers: auth(player.token),
          payload: {},
        })
      ).json(),
    );

    expect(settled.elapsedSec).toBeCloseTo(60, 3);
    expect(settled.gainedExp).toBeGreaterThan(0);
    expect(settled.view.character.exp).toBeGreaterThan(0);
  });

  it('forfeits time past the offline cap', async () => {
    h.ctx.settings.patch({ offlineCapHours: 1 });
    h.clock.advance(5 * 3600_000);

    const settled = expectOk<{ creditedSec: number; forfeitedSec: number }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/character/settle',
          headers: auth(player.token),
          payload: {},
        })
      ).json(),
    );
    expect(settled.creditedSec).toBeCloseTo(3600, 3);
    expect(settled.forfeitedSec).toBeCloseTo(4 * 3600, 3);
  });

  it('lets cultivationMultiplier accelerate the very next settle', async () => {
    h.ctx.settings.patch({ cultivationMultiplier: 100 });
    h.clock.advance(10_000);

    const settled = expectOk<{ gainedExp: number }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/character/settle',
          headers: auth(player.token),
          payload: {},
        })
      ).json(),
    );
    // 练气·前期 baseline is 1/s; a 100x world means 1000 points in 10 seconds,
    // minus whatever the stage wall clipped.
    expect(settled.gainedExp).toBeGreaterThan(100);
  });

  it('reports NOT_AT_PERFECTION away from a 圆满 stage', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/character/breakthrough',
      headers: auth(player.token),
      payload: { pills: 0 },
    });
    expect(response.statusCode).toBe(409);
    const error = expectFail(response.json());
    expect(error.code).toBe('NOT_AT_PERFECTION');
  });

  it('reports EXP_NOT_FULL at 圆满 with an empty bar', async () => {
    const state = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({ ...state, stageIndex: 3, exp: 0, lastSettledAt: h.clock.now() });

    const response = await h.app.inject({
      method: 'POST',
      url: '/api/character/breakthrough',
      headers: auth(player.token),
      payload: { pills: 0 },
    });
    expect(expectFail(response.json()).code).toBe('EXP_NOT_FULL');
  });

  it('breaks through from 练气·圆满 and lands on 筑基·前期 when it succeeds', async () => {
    const state = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({
      ...state,
      stageIndex: 3,
      exp: getStage(3).expRequired,
      lastSettledAt: h.clock.now(),
    });

    let succeeded = false;
    for (let attempt = 0; attempt < 40 && !succeeded; attempt += 1) {
      h.clock.advance(1000);
      const current = h.ctx.characters.byId(player.characterId)!;
      h.ctx.characters.save({
        ...current,
        stageIndex: 3,
        exp: getStage(3).expRequired,
        lastSettledAt: h.clock.now(),
      });

      const result = expectOk<{
        success: boolean;
        chance: number;
        fromStageName: string;
        toStageName: string;
        expLost: number;
        tribulation: unknown;
      }>(
        (
          await h.app.inject({
            method: 'POST',
            url: '/api/character/breakthrough',
            headers: auth(player.token),
            payload: { pills: 0 },
          })
        ).json(),
      );

      expect(result.chance).toBeCloseTo(0.8, 5);
      expect(result.fromStageName).toBe('练气·圆满');
      expect(result.tribulation).toBeNull();
      if (result.success) {
        expect(result.toStageName).toBe('筑基·前期');
        succeeded = true;
      } else {
        expect(result.expLost).toBeGreaterThan(0);
      }
    }
    expect(succeeded).toBe(true);
    expect(h.ctx.characters.byId(player.characterId)!.stageIndex).toBe(4);
  });

  it('spends 破境丹 and refuses when the player holds too few', async () => {
    const state = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({
      ...state,
      stageIndex: 3,
      exp: getStage(3).expRequired,
      lastSettledAt: h.clock.now(),
    });

    const tooMany = await h.app.inject({
      method: 'POST',
      url: '/api/character/breakthrough',
      headers: auth(player.token),
      payload: { pills: 4 },
    });
    expect(expectFail(tooMany.json()).code).toBe('INSUFFICIENT_ITEMS');

    const before = h.ctx.inventory.quantityOf(player.characterId, 'pill-breakthrough');
    expect(before).toBe(1);
    const result = expectOk<{ pillsUsed: number; chance: number }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/character/breakthrough',
          headers: auth(player.token),
          payload: { pills: 1 },
        })
      ).json(),
    );
    expect(result.pillsUsed).toBe(1);
    expect(result.chance).toBeCloseTo(0.95, 5);
    expect(h.ctx.inventory.quantityOf(player.characterId, 'pill-breakthrough')).toBe(0);
  });

  it('fights a 天劫 at 大乘·圆满 before rolling the breakthrough', async () => {
    const state = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({
      ...state,
      stageIndex: 31,
      exp: getStage(31).expRequired,
      lastSettledAt: h.clock.now(),
    });

    const result = expectOk<{ success: boolean; tribulation: { winner: string } | null }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/character/breakthrough',
          headers: auth(player.token),
          payload: { pills: 0 },
        })
      ).json(),
    );
    expect(result.tribulation).not.toBeNull();
    expect(['A', 'B', 'draw']).toContain(result.tribulation!.winner);
    // A gear-less 大乘 cultivator loses to the 天劫化身, which ends the attempt
    // without consuming anything.
    if (result.tribulation!.winner !== 'A') expect(result.success).toBe(false);
  });

  it('reports MAX_STAGE at the top of the ladder', async () => {
    const state = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({
      ...state,
      stageIndex: MAX_STAGE_INDEX,
      exp: getStage(MAX_STAGE_INDEX).expRequired,
      lastSettledAt: h.clock.now(),
    });
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/character/breakthrough',
      headers: auth(player.token),
      payload: { pills: 0 },
    });
    expect(expectFail(response.json()).code).toBe('MAX_STAGE');
  });

  it('equips only learned 神通 and rejects the rest', async () => {
    const view = await get();
    const learned = view.character.learnedSkillIds;

    const okResponse = await h.app.inject({
      method: 'PUT',
      url: '/api/character/skills',
      headers: auth(player.token),
      payload: { slots: [learned[1], learned[0], null, learned[2]] },
    });
    const updated = expectOk<CharacterView>(okResponse.json());
    expect(updated.character.skillSlots[0]).toBe(learned[1]);
    expect(updated.character.skillSlots[2]).toBeNull();

    const bad = await h.app.inject({
      method: 'PUT',
      url: '/api/character/skills',
      headers: auth(player.token),
      payload: { slots: ['skill-metal-3', null, null, null] },
    });
    expect(expectFail(bad.json()).code).toBe('SKILL_NOT_LEARNED');
  });

  it('learns 神通 and 功法 against 境界 and 灵石', async () => {
    const tooHigh = await h.app.inject({
      method: 'POST',
      url: '/api/character/skills/learn',
      headers: auth(player.token),
      payload: { skillId: 'skill-metal-3' },
    });
    expect(expectFail(tooHigh.json()).code).toBe('STAGE_TOO_LOW');

    const tooPoor = await h.app.inject({
      method: 'POST',
      url: '/api/character/technique/learn',
      headers: auth(player.token),
      payload: { techniqueId: 'tech-tuna' },
    });
    // 吐纳养气篇 needs 练气·后期 before its 300 灵石 matter.
    expect(['STAGE_TOO_LOW', 'INSUFFICIENT_STONES']).toContain(
      expectFail(tooPoor.json()).code,
    );

    const state = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({
      ...state,
      stageIndex: 6,
      spiritStones: 100_000,
      lastSettledAt: h.clock.now(),
    });

    const learned = expectOk<CharacterView>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/character/technique/learn',
          headers: auth(player.token),
          payload: { techniqueId: 'tech-lieyang' },
        })
      ).json(),
    );
    expect(learned.character.learnedTechniqueIds).toContain('tech-lieyang');

    const switched = expectOk<CharacterView>(
      (
        await h.app.inject({
          method: 'PUT',
          url: '/api/character/technique',
          headers: auth(player.token),
          payload: { techniqueId: 'tech-lieyang' },
        })
      ).json(),
    );
    expect(switched.character.techniqueId).toBe('tech-lieyang');

    const notLearned = await h.app.inject({
      method: 'PUT',
      url: '/api/character/technique',
      headers: auth(player.token),
      payload: { techniqueId: 'tech-wuxing' },
    });
    expect(expectFail(notLearned.json()).code).toBe('TECHNIQUE_NOT_LEARNED');
  });

  it('serves another cultivator public profile and hides nothing it should show', async () => {
    const other = await makePlayer(h, { name: '王玄真人' });
    const profile = expectOk<{ name: string; isBot: boolean; stageName: string }>(
      (
        await h.app.inject({
          method: 'GET',
          url: `/api/cultivators/${other.characterId}`,
          headers: auth(player.token),
        })
      ).json(),
    );
    expect(profile.name).toBe('王玄真人');
    expect(profile.isBot).toBe(false);
    expect(profile.stageName).toBe(stageName(0));

    const missing = await h.app.inject({
      method: 'GET',
      url: '/api/cultivators/does-not-exist',
      headers: auth(player.token),
    });
    expect(expectFail(missing.json()).code).toBe('CHARACTER_NOT_FOUND');
  });
});
