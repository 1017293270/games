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
import { BattleReplay, type ReplayFighter } from './BattleReplay';

/** A real fight from the shared engine — the replay never rolls anything. */
function makeBattle(): { battle: BattleResult; hero: ReplayFighter; beast: ReplayFighter } {
  const monster = MONSTER_BY_ID.get('monster-qingyun-wolf');
  if (!monster) throw new Error('fixture monster missing');
  const stats = computeStats({ stageIndex: 3 });
  const battle = simulateBattle({
    seed: 20260905,
    teamA: [{ id: 'hero', name: '云中鹤', stats, skills: starterSkillIds('water') }],
    teamB: [
      { id: monster.id, name: monster.name, art: monster.art, stats: monster.stats, skills: monster.skills },
    ],
  });
  return {
    battle,
    hero: { id: 'hero', name: '云中鹤', art: 'avatar/m01', motif: 'portrait', maxHp: stats.hp },
    beast: { id: monster.id, name: monster.name, art: monster.art, motif: 'beast', maxHp: monster.stats.hp },
  };
}

describe('BattleReplay', () => {
  it('opens on round one and offers a skip', () => {
    const { battle, hero, beast } = makeBattle();
    render(
      <BattleReplay battle={battle} teamA={[hero]} teamB={[beast]} onClose={() => {}} />,
    );
    expect(screen.getByRole('dialog', { name: '战斗回放' })).toBeInTheDocument();
    expect(screen.getByText('第 1 回合')).toBeInTheDocument();
    // Each fighter's name appears twice: once as the card label, once inside
    // the placeholder artwork it draws while the bitmap is missing.
    expect(screen.getAllByText('云中鹤').length).toBeGreaterThan(0);
    expect(screen.getAllByText('青云狼').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '跳过' })).toBeInTheDocument();
  });

  it('consumes the whole log on skip and shows the verdict', async () => {
    const user = userEvent.setup();
    const { battle, hero, beast } = makeBattle();
    render(
      <BattleReplay battle={battle} teamA={[hero]} teamB={[beast]} onClose={() => {}} />,
    );

    await user.click(screen.getByRole('button', { name: '跳过' }));

    const verdict = battle.winner === 'A' ? '胜' : battle.winner === 'draw' ? '和' : '负';
    expect(screen.getByText(verdict)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${battle.rounds} 回合 ·`))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '跳过' })).not.toBeInTheDocument();
  });

  it('leaves each fighter on the hp the engine recorded', async () => {
    const user = userEvent.setup();
    const { battle, hero, beast } = makeBattle();
    render(
      <BattleReplay battle={battle} teamA={[hero]} teamB={[beast]} onClose={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: '跳过' }));

    for (const fighter of [hero, beast]) {
      const finalHp = Math.max(0, Math.round(battle.finalHp[fighter.id] ?? 0));
      expect(screen.getByText(String(finalHp))).toBeInTheDocument();
    }
  });

  it('hands control back through the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { battle, hero, beast } = makeBattle();
    render(<BattleReplay battle={battle} teamA={[hero]} teamB={[beast]} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '跳过' }));
    await user.click(screen.getByRole('button', { name: '收功' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
