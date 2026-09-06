import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  computeStats,
  simulateBattle,
  starterSkillIds,
  type ArenaChallengedEvent,
  type CharacterView,
} from '@xianxia/shared';
import { buildView, getWorld } from '../../api/mock';
import { InkFrame, Modal } from '../../design';
import { useArenaStore } from '../../store/arena';
import { useCharacterStore } from '../../store/character';
import { useUiStore } from '../../store/ui';
import { ArenaChallengedNotice } from './ArenaChallengedNotice';

function demoView(): CharacterView {
  const world = getWorld();
  const character = world.characters.get('char-demo');
  if (!character) throw new Error('demo character missing');
  return buildView(world, character);
}

/** An inbound 论道 carrying a real log, so 看回放 has something to play. */
function hail(name: string, defenderLost: boolean): ArenaChallengedEvent {
  const view = demoView();
  const stats = computeStats({ stageIndex: view.character.stageIndex });
  const attackerId = `bot-${name}`;
  const battle = simulateBattle({
    seed: 20260905,
    teamA: [{ id: attackerId, name, stats, skills: starterSkillIds('metal') }],
    teamB: [
      {
        id: view.character.id,
        name: view.character.name,
        stats,
        skills: starterSkillIds('water'),
      },
    ],
  });
  return {
    attackerId,
    attackerName: name,
    attackerStageName: '筑基三层',
    attackerAvatarArt: 'avatar/m03',
    defenderLost,
    ratingDelta: defenderLost ? -12 : 9,
    battle,
    foughtAt: Date.now(),
  };
}

const onSegment = vi.fn();

/** 秘境论道 in miniature: page content, whatever layer is open, the notice. */
function Screen({ busy }: { busy: boolean }) {
  return (
    <InkFrame>
      <button type="button" onClick={onSegment}>
        围攻
      </button>
      <Modal open={busy} title="秘境回放">
        <p>第 一 阵</p>
      </Modal>
      <ArenaChallengedNotice />
    </InkFrame>
  );
}

beforeEach(() => {
  onSegment.mockClear();
  useArenaStore.getState().reset();
  useCharacterStore.getState().reset();
  useUiStore.setState({ overlayDepth: 0, toasts: [] });
});

describe('ArenaChallengedNotice', () => {
  it('holds the report while another layer is open and shows it once that closes', () => {
    useArenaStore.getState().receiveChallenge(hail('紫电子', false));

    const { rerender } = render(<Screen busy />);
    expect(screen.queryByText(/登门论道/)).not.toBeInTheDocument();

    rerender(<Screen busy={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('登门论道');
  });

  it('reports without a scrim, and does not block the next notice itself', async () => {
    const user = userEvent.setup();
    useArenaStore.getState().receiveChallenge(hail('紫电子', false));
    render(<Screen busy={false} />);

    // jsdom does not hit-test, so the proof of "not blocking" is structural:
    // no scrim, no dialog, and nothing added to the layer count.
    expect(document.querySelector('.scrim')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useUiStore.getState().overlayDepth).toBe(0);

    await user.click(screen.getByRole('button', { name: '围攻' }));
    expect(onSegment).toHaveBeenCalledOnce();
  });

  it('merges several bouts into one bar, newest first, with the rest counted', () => {
    useArenaStore.getState().receiveChallenge(hail('紫电子', false));
    useArenaStore.getState().receiveChallenge(hail('青玄子', true));
    render(<Screen busy={false} />);

    const bar = screen.getByRole('status');
    expect(bar).toHaveTextContent('青玄子');
    expect(bar).toHaveTextContent('你未能守住');
    expect(bar).toHaveTextContent('另有 1 场');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('clears the whole batch on 知道了', async () => {
    const user = userEvent.setup();
    useArenaStore.getState().receiveChallenge(hail('紫电子', false));
    useArenaStore.getState().receiveChallenge(hail('青玄子', true));
    render(<Screen busy={false} />);

    await user.click(screen.getByRole('button', { name: '知道了' }));
    expect(useArenaStore.getState().challenges).toHaveLength(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('plays the bout on 看回放 and clears once the replay is closed', async () => {
    const user = userEvent.setup();
    useCharacterStore.getState().setView(demoView());
    useArenaStore.getState().receiveChallenge(hail('紫电子', true));
    render(<Screen busy={false} />);

    await user.click(screen.getByRole('button', { name: '看回放' }));
    expect(screen.getByRole('dialog', { name: '战斗回放' })).toBeInTheDocument();
    expect(useArenaStore.getState().challenges).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '跳过' }));
    await user.click(screen.getByRole('button', { name: '收功' }));
    expect(useArenaStore.getState().challenges).toHaveLength(0);
    expect(useUiStore.getState().overlayDepth).toBe(0);
  });

  it('offers no replay before the character view has loaded', () => {
    useArenaStore.getState().receiveChallenge(hail('紫电子', false));
    render(<Screen busy={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('登门论道');
    expect(screen.queryByRole('button', { name: '看回放' })).not.toBeInTheDocument();
  });
});
