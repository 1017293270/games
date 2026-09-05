import { describe, expect, it } from 'vitest';
import { simulateBattle } from '../src/combat/engine.js';
import { DEFAULT_MAX_ROUNDS, type BattleInput, type Combatant } from '../src/combat/types.js';
import { baseStatsForStage } from '../src/cultivation/attributes.js';
import { MONSTER_BY_ID } from '../src/content/monsters.js';
import { SKILL_BY_ID } from '../src/content/skills.js';
import { createRng } from '../src/core/rng.js';

function fighter(id: string, stageIndex: number, skills: string[] = []): Combatant {
  return { id, name: id, stats: baseStatsForStage(stageIndex), skills };
}

function duel(seed: number, overrides: Partial<BattleInput> = {}): BattleInput {
  return {
    seed,
    teamA: [fighter('a1', 6, ['skill-fire-1', 'skill-earth-1'])],
    teamB: [fighter('b1', 6, ['skill-water-1', 'skill-wood-1'])],
    ...overrides,
  };
}

describe('determinism', () => {
  it('produces an identical log for the same seed and input', () => {
    const a = simulateBattle(duel(12345));
    const b = simulateBattle(duel(12345));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.winner).toBe(b.winner);
    expect(a.rounds).toBe(b.rounds);
    expect(a.finalHp).toEqual(b.finalHp);
    expect(a.damageDealt).toEqual(b.damageDealt);
  });

  it('stays identical across many seeds', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      expect(JSON.stringify(simulateBattle(duel(seed)))).toBe(
        JSON.stringify(simulateBattle(duel(seed))),
      );
    }
  });

  it('produces different logs for different seeds', () => {
    const logs = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      logs.add(JSON.stringify(simulateBattle(duel(seed)).log));
    }
    // Not every seed need differ, but the vast majority must.
    expect(logs.size).toBeGreaterThan(30);
  });

  it('echoes the seed so a result alone can be re-derived', () => {
    expect(simulateBattle(duel(777)).seed).toBe(777);
  });

  it('is unaffected by negative or huge seeds', () => {
    for (const seed of [-1, -999999, 2 ** 31 - 1, -(2 ** 31)]) {
      const a = simulateBattle(duel(seed));
      const b = simulateBattle(duel(seed));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.rounds).toBeGreaterThan(0);
    }
  });
});

describe('termination', () => {
  it('never exceeds the default round cap', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const r = simulateBattle(duel(seed));
      expect(r.rounds).toBeLessThanOrEqual(DEFAULT_MAX_ROUNDS);
      expect(r.rounds).toBeGreaterThan(0);
    }
  });

  it('honours an explicit maxRounds', () => {
    // Two immovable walls: huge 气血, no damage output to speak of.
    const wall = (id: string): Combatant => ({
      id,
      name: id,
      stats: { ...baseStatsForStage(0), hp: 5_000_000, atk: 1, def: 100_000 },
      skills: [],
    });
    for (const maxRounds of [1, 3, 7, 30, 60]) {
      const r = simulateBattle({ seed: 5, teamA: [wall('a')], teamB: [wall('b')], maxRounds });
      expect(r.rounds).toBe(maxRounds);
      expect(r.reason).toBe('max_rounds');
    }
  });

  it('always emits exactly one battle_end event, last', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const r = simulateBattle(duel(seed));
      const ends = r.log.filter((e) => e.type === 'battle_end');
      expect(ends).toHaveLength(1);
      expect(r.log[r.log.length - 1]?.type).toBe('battle_end');
    }
  });

  it('ends by wipe when one side is clearly stronger', () => {
    const r = simulateBattle({
      seed: 3,
      teamA: [fighter('strong', 20, ['skill-fire-3', 'skill-water-3'])],
      teamB: [fighter('weak', 0)],
    });
    expect(r.winner).toBe('A');
    expect(r.reason).toBe('team_wiped');
    expect(r.finalHp['weak']).toBe(0);
  });

  it('resolves a max-rounds stalemate by remaining 气血 share', () => {
    const tanky = (id: string, hp: number): Combatant => ({
      id,
      name: id,
      stats: { ...baseStatsForStage(0), hp, atk: 2, def: 5000 },
      skills: [],
    });
    // A has more headroom, so a timeout should hand it the win.
    const r = simulateBattle({
      seed: 1,
      teamA: [tanky('a', 100_000)],
      teamB: [tanky('b', 100)],
      maxRounds: 5,
    });
    expect(r.reason).toBe('max_rounds');
    expect(r.winner).toBe('A');
  });
});

describe('log structure', () => {
  it('opens each round with round_start listing the turn order', () => {
    const r = simulateBattle(duel(42));
    const starts = r.log.filter((e) => e.type === 'round_start');
    expect(starts.length).toBe(r.rounds);
    for (const [i, e] of starts.entries()) {
      expect(e.type).toBe('round_start');
      if (e.type === 'round_start') {
        expect(e.round).toBe(i + 1);
        expect(e.order.length).toBeGreaterThan(0);
      }
    }
  });

  it('sorts the turn order by 速度, fastest first', () => {
    const slow: Combatant = { id: 'slow', name: 'slow', stats: { ...baseStatsForStage(6), spd: 5 }, skills: [] };
    const fast: Combatant = { id: 'fast', name: 'fast', stats: { ...baseStatsForStage(6), spd: 50 }, skills: [] };
    const r = simulateBattle({ seed: 9, teamA: [slow], teamB: [fast] });
    const first = r.log.find((e) => e.type === 'round_start');
    expect(first?.type === 'round_start' && first.order[0]).toBe('fast');
  });

  it('records a death event when a combatant drops', () => {
    const r = simulateBattle({
      seed: 3,
      teamA: [fighter('strong', 20, ['skill-fire-3'])],
      teamB: [fighter('weak', 0)],
    });
    const deaths = r.log.filter((e) => e.type === 'death');
    expect(deaths).toHaveLength(1);
    expect(deaths[0]?.type === 'death' && deaths[0].targetId).toBe('weak');
  });

  it('never lets 气血 go below zero', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const r = simulateBattle(duel(seed));
      for (const hp of Object.values(r.finalHp)) expect(hp).toBeGreaterThanOrEqual(0);
      for (const e of r.log) {
        if (e.type === 'damage' || e.type === 'heal') expect(e.targetHp).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('reports damage dealt consistent with the damage events', () => {
    const r = simulateBattle(duel(21));
    const tally: Record<string, number> = {};
    for (const e of r.log) {
      if (e.type === 'damage' && !e.dodged) tally[e.actorId] = (tally[e.actorId] ?? 0) + e.amount;
    }
    for (const [id, total] of Object.entries(tally)) {
      expect(r.damageDealt[id]).toBe(total);
    }
  });

  it('marks dodged hits with zero damage', () => {
    // Very high 闪避 guarantees some dodges across many seeds.
    const slippery: Combatant = {
      id: 'slippery',
      name: 'slippery',
      stats: { ...baseStatsForStage(6), eva: 0.9 },
      skills: [],
    };
    let dodges = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      const r = simulateBattle({ seed, teamA: [fighter('a', 6)], teamB: [slippery] });
      for (const e of r.log) {
        if (e.type === 'damage' && e.dodged) {
          expect(e.amount).toBe(0);
          dodges += 1;
        }
      }
    }
    expect(dodges).toBeGreaterThan(0);
  });
});

describe('skill rotation and 灵力', () => {
  it('falls back to 普攻 when a combatant has no 神通', () => {
    const r = simulateBattle({
      seed: 4,
      teamA: [fighter('a', 6)],
      teamB: [fighter('b', 6)],
    });
    const casts = r.log.filter((e) => e.type === 'skill_cast');
    expect(casts.length).toBeGreaterThan(0);
    for (const e of casts) {
      if (e.type === 'skill_cast') {
        expect(e.skillId).toBeNull();
        expect(e.skillName).toBe('普攻');
        expect(e.manaSpent).toBe(0);
      }
    }
  });

  it('cycles the four slots in order', () => {
    const skills = ['skill-fire-1', 'skill-water-1', 'skill-metal-1', 'skill-wood-1'];
    const r = simulateBattle({
      seed: 8,
      teamA: [{ id: 'a', name: 'a', stats: { ...baseStatsForStage(10), spd: 99 }, skills }],
      teamB: [{ id: 'b', name: 'b', stats: { ...baseStatsForStage(14), hp: 900_000 }, skills: [] }],
      maxRounds: 8,
    });
    const casts = r.log
      .filter((e) => e.type === 'skill_cast' && e.actorId === 'a')
      .map((e) => (e.type === 'skill_cast' ? e.skillId : null));
    // All four tier-1 skills are cheap and off-cooldown, so the first four
    // casts must walk the rotation in slot order.
    expect(casts.slice(0, 4)).toEqual(skills);
  });

  it('falls back to 普攻 when 灵力 runs dry', () => {
    // A single expensive skill: 50 mana, +15 regen — it cannot fire every round.
    const r = simulateBattle({
      seed: 11,
      teamA: [{ id: 'a', name: 'a', stats: { ...baseStatsForStage(16), spd: 99 }, skills: ['skill-fire-3'] }],
      teamB: [{ id: 'b', name: 'b', stats: { ...baseStatsForStage(20), hp: 5_000_000 }, skills: [] }],
      maxRounds: 12,
    });
    const aCasts = r.log.filter((e) => e.type === 'skill_cast' && e.actorId === 'a');
    const basics = aCasts.filter((e) => e.type === 'skill_cast' && e.skillId === null);
    expect(basics.length).toBeGreaterThan(0);
  });

  it('never spends more 灵力 than a skill costs', () => {
    const r = simulateBattle(duel(15));
    for (const e of r.log) {
      if (e.type === 'skill_cast' && e.skillId) {
        expect(e.manaSpent).toBe(SKILL_BY_ID.get(e.skillId)?.manaCost);
      }
    }
  });

  it('applies buff and debuff modifiers with their durations', () => {
    const r = simulateBattle({
      seed: 6,
      teamA: [{ id: 'a', name: 'a', stats: baseStatsForStage(14), skills: ['skill-earth-1'] }],
      teamB: [{ id: 'b', name: 'b', stats: { ...baseStatsForStage(14), hp: 900_000 }, skills: ['skill-metal-3'] }],
      maxRounds: 10,
    });
    const buffs = r.log.filter((e) => e.type === 'buff');
    const debuffs = r.log.filter((e) => e.type === 'debuff');
    expect(buffs.length).toBeGreaterThan(0);
    expect(debuffs.length).toBeGreaterThan(0);
    for (const e of [...buffs, ...debuffs]) {
      if (e.type === 'buff' || e.type === 'debuff') expect(e.durationRounds).toBeGreaterThan(0);
    }
  });

  it('heals without exceeding max 气血', () => {
    const r = simulateBattle({
      seed: 13,
      teamA: [
        { id: 'healer', name: 'healer', stats: baseStatsForStage(14), skills: ['skill-wood-1'] },
        { id: 'tank', name: 'tank', stats: baseStatsForStage(14), skills: [] },
      ],
      teamB: [{ id: 'b', name: 'b', stats: baseStatsForStage(15), skills: ['skill-fire-1'] }],
    });
    for (const e of r.log) {
      if (e.type === 'heal') expect(e.amount).toBeGreaterThanOrEqual(0);
    }
    const maxHp = baseStatsForStage(14).hp;
    expect(r.finalHp['tank']).toBeLessThanOrEqual(maxHp);
  });
});

describe('team battles and blood pools', () => {
  it('supports a four-versus-one raid', () => {
    const raiders = [0, 1, 2, 3].map((i) => fighter(`r${i}`, 12, ['skill-fire-1', 'skill-metal-1']));
    const boss = MONSTER_BY_ID.get('boss-youming-ghost-emperor');
    expect(boss).toBeDefined();
    const r = simulateBattle({
      seed: 99,
      teamA: raiders,
      teamB: [
        { id: 'boss', name: boss!.name, stats: boss!.stats, skills: [...boss!.skills] },
      ],
    });
    expect(['A', 'B', 'draw']).toContain(r.winner);
    expect(Object.keys(r.finalHp)).toHaveLength(5);
  });

  it('honours an hp override for a shared blood pool', () => {
    const r = simulateBattle({
      seed: 7,
      teamA: [fighter('a', 10, ['skill-fire-1'])],
      teamB: [{ ...fighter('pool', 10), hp: 999_999 }],
      maxRounds: 5,
    });
    // The pool starts far above its own stat block and survives the cap.
    expect(r.finalHp['pool']).toBeGreaterThan(baseStatsForStage(10).hp);
    expect(r.reason).toBe('max_rounds');
  });

  it('lets a wounded combatant start below full 气血', () => {
    const full = baseStatsForStage(10).hp;
    const r = simulateBattle({
      seed: 2,
      teamA: [fighter('a', 10)],
      teamB: [{ ...fighter('hurt', 10), hp: Math.round(full * 0.1) }],
      maxRounds: 1,
    });
    expect(r.finalHp['hurt']).toBeLessThanOrEqual(Math.round(full * 0.1));
  });

  it('rejects duplicate combatant ids', () => {
    expect(() =>
      simulateBattle({ seed: 1, teamA: [fighter('same', 5)], teamB: [fighter('same', 5)] }),
    ).toThrow(/duplicate combatant id/);
  });

  it('ignores unknown skill ids rather than crashing', () => {
    const r = simulateBattle({
      seed: 1,
      teamA: [fighter('a', 5, ['no-such-skill'])],
      teamB: [fighter('b', 5)],
    });
    expect(r.rounds).toBeGreaterThan(0);
    for (const e of r.log) {
      if (e.type === 'skill_cast') expect(e.skillId).toBeNull();
    }
  });
});

describe('balance sanity', () => {
  it('lets a same-stage player beat a normal 妖兽 most of the time', () => {
    const monster = MONSTER_BY_ID.get('monster-qingyun-wolf');
    expect(monster).toBeDefined();
    let wins = 0;
    const trials = 200;
    for (let seed = 0; seed < trials; seed += 1) {
      const r = simulateBattle({
        seed,
        teamA: [fighter('player', 2, ['skill-fire-1', 'skill-earth-1'])],
        teamB: [
          { id: 'wolf', name: monster!.name, stats: monster!.stats, skills: [...monster!.skills] },
        ],
      });
      if (r.winner === 'A') wins += 1;
    }
    expect(wins / trials).toBeGreaterThan(0.6);
  });

  it('resolves ordinary duels well inside the round cap', () => {
    let sum = 0;
    const trials = 100;
    for (let seed = 0; seed < trials; seed += 1) sum += simulateBattle(duel(seed)).rounds;
    const avg = sum / trials;
    expect(avg).toBeGreaterThan(1);
    expect(avg).toBeLessThan(DEFAULT_MAX_ROUNDS);
  });

  it('gives the higher-stage fighter a decisive edge', () => {
    let wins = 0;
    for (let seed = 0; seed < 100; seed += 1) {
      const r = simulateBattle({
        seed,
        teamA: [fighter('high', 11, ['skill-fire-1'])],
        teamB: [fighter('low', 8, ['skill-fire-1'])],
      });
      if (r.winner === 'A') wins += 1;
    }
    expect(wins).toBeGreaterThan(85);
  });
});

describe('rng primitives', () => {
  it('reproduces the same stream for the same seed', () => {
    const a = createRng(4242);
    const b = createRng(4242);
    for (let i = 0; i < 100; i += 1) expect(a.next()).toBe(b.next());
  });

  it('stays inside [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 5000; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('respects int bounds', () => {
    const rng = createRng(3);
    for (let i = 0; i < 2000; i += 1) {
      const v = rng.int(3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });

  it('honours weights', () => {
    const rng = createRng(11);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 4000; i += 1) counts[rng.weighted(['a', 'b'] as const, [9, 1])] += 1;
    expect(counts.a / 4000).toBeGreaterThan(0.85);
  });

  it('rejects degenerate weighted input', () => {
    const rng = createRng(1);
    expect(() => rng.weighted([], [])).toThrow();
    expect(() => rng.weighted(['a'], [0])).toThrow();
    expect(() => rng.weighted(['a', 'b'], [1])).toThrow();
    expect(() => rng.pick([])).toThrow();
  });
});
