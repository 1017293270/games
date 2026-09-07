import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { API, getProgression, RELICS, RELIC_SETS } from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { ApiError, setTokenSource } from '../../api/http';
import { DEMO_PASSWORD, DEMO_USERNAME, resetWorld } from '../../api/mock';
import { getWorld } from '../../api/mock/world';
import { findHandler } from '../../api/mock/handlers';
import { useCharacterStore } from '../../store/character';
import { useProgressionStore } from '../../store/progression';
import { ProgressionPage } from './ProgressionPage';

beforeEach(async () => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  resetWorld();
  const auth = await api.login({ username: DEMO_USERNAME, password: DEMO_PASSWORD });
  setTokenSource(() => auth.token);
  useCharacterStore.getState().setView(await api.getCharacter());
  useProgressionStore.setState({ busy: false, error: null, pendingDraw: null, history: [] });
});

function renderPage(page: 'treasures' | 'relics' | 'gacha' | 'daily') {
  return render(
    <MemoryRouter>
      <ProgressionPage page={page} />
    </MemoryRouter>,
  );
}
async function settled() {
  await waitFor(() => expect(useProgressionStore.getState().busy).toBe(false));
}

describe('仙府养成', () => {
  it('covers every progression endpoint in mock', () => {
    for (const endpoint of Object.values(API.progression))
      expect(findHandler(endpoint)).toBeTypeOf('function');
  });
  it('claims starter, equips and upgrades a real mock-backed treasure', async () => {
    const user = userEvent.setup();
    renderPage('treasures');
    await settled();
    await user.click(screen.getByRole('button', { name: '领取入门法宝' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '领取入门法宝' })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: '清音铃' }));
    const sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: '设为辅助一' }));
    await waitFor(() =>
      expect(within(sheet).getByRole('button', { name: '已装辅助一' })).toBeDisabled(),
    );
    await user.click(within(sheet).getByRole('button', { name: '升级' }));
    await waitFor(() => expect(within(sheet).getByText(/等级 2\/100/)).toBeInTheDocument());
    await user.click(within(sheet).getByRole('button', { name: '注灵' }));
    await waitFor(() => expect(within(sheet).getByText(/注灵 1\/10/)).toBeInTheDocument());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('free draws both pools independently and disables unaffordable spending', async () => {
    const user = userEvent.setup();
    renderPage('gacha');
    await settled();
    expect(screen.getByRole('button', { name: '寻宝一次 · 160仙玉' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '每日免费寻宝' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: '跳过揭示动画' }));
    await user.click(screen.getByRole('button', { name: '收入囊中' }));
    expect(screen.getByRole('button', { name: '今日免费已用' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '古宝遗珍' }));
    await user.click(screen.getByRole('button', { name: '每日免费寻宝' }));
    await screen.findByRole('dialog');
    expect(useCharacterStore.getState().view?.character.progression?.daily.freePools).toEqual([
      'treasure',
      'relic',
    ]);
    expect(useCharacterStore.getState().view?.character.progression?.materials.jade).toBe(0);
  });
  it('retries an uncertain paid draw with the original request and no second charge', async () => {
    await useProgressionStore
      .getState()
      .run(() => api.progressionClaim({ kind: 'starter', id: 'starter' }));
    const original = api.progressionDraw;
    const calls = vi.spyOn(api, 'progressionDraw').mockImplementationOnce(async (request) => {
      await original(request);
      throw new ApiError('INTERNAL_ERROR', '连接中断，结果待确认');
    });
    const user = userEvent.setup();
    renderPage('gacha');
    await settled();
    await user.click(screen.getByRole('button', { name: '寻宝一次 · 160仙玉' }));
    await screen.findByText('连接中断，结果待确认');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '古宝遗珍' }));
    await user.click(screen.getByRole('button', { name: '重试上次寻宝' }));
    await screen.findByRole('dialog');
    expect(calls.mock.calls[0]?.[0]).toEqual(calls.mock.calls[1]?.[0]);
    const state = useCharacterStore.getState().view!.character.progression!;
    expect(state.materials.jade).toBe(0);
    expect(state.gacha.treasure.total).toBe(1);
    expect(state.gacha.relic.total).toBe(0);
  });
  it('shows activated three-piece collections and infuses owned relics', async () => {
    const view = useCharacterStore.getState().view!;
    const p = getProgression(undefined, Date.now());
    p.materials.stardust = 100;
    const set = RELIC_SETS[0]!;
    p.relics = set.relicIds.map((definitionId) => ({
      definitionId,
      spiritLevel: 0,
      stars: 0,
      fragments: 0,
    }));
    getWorld().characters.set(view.character.id, { ...view.character, progression: p });
    const user = userEvent.setup();
    renderPage('relics');
    await settled();
    expect(screen.getByText(`${set.name} · 3/3 已激活`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: RELICS[0]!.name }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '注灵' }));
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByText(/注灵 1\/10/)).toBeInTheDocument(),
    );
  });
});
