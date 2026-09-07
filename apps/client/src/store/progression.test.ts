import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/endpoints';
import { ApiError, setTokenSource } from '../api/http';
import { DEMO_USERNAME, DEMO_PASSWORD, resetWorld } from '../api/mock';
import { useCharacterStore } from './character';
import { useSessionStore } from './session';
import { progressionRequestId, useProgressionStore } from './progression';

beforeEach(async () => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  resetWorld();
  const session = await api.login({ username: DEMO_USERNAME, password: DEMO_PASSWORD });
  setTokenSource(() => session.token);
  useCharacterStore.getState().setView(await api.getCharacter());
  useProgressionStore.getState().reset();
});

describe('progression request lifecycle', () => {
  it('generates an HTTP-safe id without randomUUID', () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('unavailable on HTTP');
    });
    expect(progressionRequestId()).toMatch(/^[a-f0-9]{32}$/);
    expect(progressionRequestId()).not.toBe(progressionRequestId());
  });
  it('prevents rapid duplicate draws', async () => {
    const spy = vi.spyOn(api, 'progressionDraw');
    const first = useProgressionStore.getState().draw({ pool: 'treasure', count: 1, free: true });
    const second = useProgressionStore.getState().draw({ pool: 'treasure', count: 1, free: true });
    expect(await second).toBeNull();
    await first;
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('clears pending state on account change and discards the previous account response', async () => {
    const response = await api.progression();
    let finish!: (value: typeof response) => void;
    const request = useProgressionStore.getState().run(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    useProgressionStore.setState({
      pendingDraw: { pool: 'treasure', count: 1, requestId: 'old' },
      history: [{ id: 'old', requestId: 'old', at: 0, results: [] }],
    });
    useSessionStore.setState({ token: 'new-account-token' });
    expect(useProgressionStore.getState().pendingDraw).toBeNull();
    expect(useProgressionStore.getState().history).toEqual([]);
    const oldView = useCharacterStore.getState().view;
    finish({
      ...response,
      view: { ...response.view, character: { ...response.view.character, name: '旧会话响应' } },
    });
    expect(await request).toBeNull();
    expect(useCharacterStore.getState().view).toBe(oldView);
  });
  it('restores the same pending request after page reload without a second debit', async () => {
    await useProgressionStore
      .getState()
      .run(() => api.progressionClaim({ kind: 'starter', id: 'starter' }));
    const original = api.progressionDraw;
    vi.spyOn(api, 'progressionDraw').mockImplementationOnce(async (request) => {
      await original(request);
      throw new ApiError('INTERNAL_ERROR', 'network lost');
    });
    await useProgressionStore.getState().draw({ pool: 'treasure', count: 1 });
    const pending = useProgressionStore.getState().pendingDraw;
    useProgressionStore.getState().reset();
    await useProgressionStore.getState().load();
    expect(useProgressionStore.getState().pendingDraw).toEqual(pending);
    await useProgressionStore.getState().retryDraw();
    expect(useCharacterStore.getState().view?.character.progression?.gacha.treasure.total).toBe(1);
    expect(useCharacterStore.getState().view?.character.progression?.materials.jade).toBe(0);
    expect(useProgressionStore.getState().pendingDraw).toBeNull();
  });

  it('still draws when browser storage is denied', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const result = await useProgressionStore
      .getState()
      .draw({ pool: 'treasure', count: 1, free: true });
    expect(result?.results).toHaveLength(1);
    expect(useProgressionStore.getState().pendingDraw).toBeNull();
  });
});
