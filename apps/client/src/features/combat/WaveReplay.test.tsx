import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  computeStats,
  MONSTER_BY_ID,
  simulateBattle,
  starterSkillIds,
  type BattleResult,
} from '@xianxia/shared';
import type { ReplayFighter } from './BattleReplay';
import { WaveReplay, waveLabel } from './WaveReplay';

const HERO_ID = 'hero';

/** Two real waves from the shared engine, 气血 carried from the first. */
function makeRun(): { battles: BattleResult[]; hero: ReplayFighter; waves: ReplayFighter[][] } {
  const wolf = MONSTER_BY_ID.get('monster-qingyun-wolf');
  const boss = MONSTER_BY_ID.get('boss-qingyun-tiger-king');
  if (!wolf || !boss) throw new Error('fixture monsters missing');

  // Well above the realm the 秘境 is tuned for, so both waves are survivable and
  // the run reaches its verdict rather than ending on wave one.
  const stats = computeStats({ stageIndex: 20 });
  const hero = { id: HERO_ID, name: '云中鹤', stats, skills: starterSkillIds('water') };

  const first = simulateBattle({
    seed: 20260905,
    teamA: [hero],
    teamB: [{ id: 'wolf#0', name: wolf.name, stats: wolf.stats, skills: wolf.skills }],
  });
  const second = simulateBattle({
    seed: 20260906,
    teamA: [{ ...hero, hp: Math.max(1, first.finalHp[HERO_ID] ?? stats.hp) }],
    teamB: [{ id: 'boss#0', name: boss.name, stats: boss.stats, skills: boss.skills }],
  });

  return {
    battles: [first, second],
    hero: { id: HERO_ID, name: '云中鹤', art: 'avatar/m01', motif: 'portrait', maxHp: stats.hp },
    waves: [
      [{ id: 'wolf#0', name: wolf.name, art: wolf.art, motif: 'beast', maxHp: wolf.stats.hp }],
      [{ id: 'boss#0', name: boss.name, art: boss.art, motif: 'beast', maxHp: boss.stats.hp }],
    ],
  };
}

describe('waveLabel', () => {
  it('numbers the trash waves and names the last one for its boss', () => {
    expect(waveLabel(0, 3)).toBe('第 一 阵');
    expect(waveLabel(1, 3)).toBe('第 二 阵');
    expect(waveLabel(2, 3, '虎王')).toBe('镇守 · 虎王');
  });
});

describe('WaveReplay', () => {
  it('opens on the first wave and offers to press on rather than close', async () => {
    const user = userEvent.setup();
    const { battles, hero, waves } = makeRun();
    render(
      <WaveReplay
        battles={battles}
        teamA={[hero]}
        waves={waves}
        labels={['第 一 阵', '镇守 · 虎王']}
        title="青云秘境"
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('青云秘境 · 第 一 阵')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '跳过' }));
    expect(screen.getByRole('button', { name: '再进一阵' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收功' })).not.toBeInTheDocument();
  });

  it('shows the wave gate, then plays the next wave from the 气血 it carried', async () => {
    const user = userEvent.setup();
    const { battles, hero, waves } = makeRun();
    render(
      <WaveReplay
        battles={battles}
        teamA={[hero]}
        waves={waves}
        labels={['第 一 阵', '镇守 · 虎王']}
        title="青云秘境"
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: '跳过' }));
    await user.click(screen.getByRole('button', { name: '再进一阵' }));

    // The gate names the wave ahead while the run pauses.
    expect(screen.getByRole('status')).toHaveTextContent('镇守 · 虎王');
    expect(screen.getByRole('status')).toHaveTextContent('1 / 2');

    const second = await screen.findByText('青云秘境 · 镇守 · 虎王', undefined, { timeout: 3_000 });
    expect(second).toBeInTheDocument();

    // 气血 opens where the previous wave left it, not back at full.
    const carried = Math.round(Math.max(0, battles[0]?.finalHp[HERO_ID] ?? 0));
    expect(screen.getByText(String(carried))).toBeInTheDocument();
  });

  it('hands control back only after the last wave', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { battles, hero, waves } = makeRun();
    render(
      <WaveReplay
        battles={battles}
        teamA={[hero]}
        waves={waves}
        labels={['第 一 阵', '镇守 · 虎王']}
        title="青云秘境"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: '跳过' }));
    await user.click(screen.getByRole('button', { name: '再进一阵' }));
    await screen.findByText('青云秘境 · 镇守 · 虎王', undefined, { timeout: 3_000 });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '跳过' }));
    await user.click(screen.getByRole('button', { name: '收功' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
