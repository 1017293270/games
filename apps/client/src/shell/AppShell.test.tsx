import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { CharacterView, SettleResponse, User, ZoneLoot } from '@xianxia/shared';
import { buildView, getWorld } from '../api/mock';
import { useCharacterStore } from '../store/character';
import { useSessionStore } from '../store/session';
import * as socketStore from '../store/socket';
import { useZoneStore } from '../store/zone';
import { AppShell } from './AppShell';

/**
 * 闭关归来 for a character that never left the field.
 *
 * 留场 is the whole point of a 战斗大地图 — the character keeps fighting while
 * the app is shut — but the server settles its 修炼 every few seconds to pay it,
 * so `creditedSec` comes back tiny for the very players who were away longest.
 * What proves the absence is the `zone:loot` receipt that follows the field's
 * restore, and these are the things the shell has to get right about it.
 */

const RETURN_THRESHOLD_MS = 120_000;

function demoView(): CharacterView {
  const world = getWorld();
  const character = world.characters.get('char-demo');
  if (!character) throw new Error('demo character missing');
  return buildView(world, character);
}

function settleResult(over: Partial<SettleResponse> = {}): SettleResponse {
  return {
    view: demoView(),
    gainedExp: 40,
    elapsedSec: 6,
    creditedSec: 6,
    forfeitedSec: 0,
    stageUps: 0,
    stagesPassed: [],
    ...over,
  };
}

/** A 战果 receipt whose accrual window opened `agoMs` ago. */
function receipt(agoMs: number, over: Partial<ZoneLoot> = {}): ZoneLoot {
  return {
    exp: 1_200,
    spiritStones: 195,
    items: [],
    kills: 37,
    bossKills: 1,
    since: Date.now() - agoMs,
    ...over,
  };
}

/** Holds the settle the shell is about to get, and how long it makes it wait. */
let pending: { result: SettleResponse | null; hold: Promise<void> } = {
  result: settleResult(),
  hold: Promise.resolve(),
};

function shell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<div>洞天</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const user: User = {
  id: 'user-demo',
  username: 'demo',
  isAdmin: false,
  banned: false,
  createdAt: Date.now(),
  characterId: 'char-demo',
};

beforeEach(() => {
  pending = { result: settleResult(), hold: Promise.resolve() };
  // The shell opens a socket of its own; these tests hand it the events instead.
  vi.spyOn(socketStore, 'openSocket').mockImplementation(() => {});
  vi.spyOn(socketStore, 'closeSocket').mockImplementation(() => {});
  useZoneStore.getState().reset();
  useCharacterStore.setState({
    view: demoView(),
    settle: async () => {
      await pending.hold;
      return pending.result;
    },
    load: async () => {},
  });
  useSessionStore.setState({ status: 'ready', token: 'token-test', user, clockOffsetMs: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  useCharacterStore.getState().reset();
  useZoneStore.getState().reset();
  useSessionStore.setState({ status: 'boot', token: null, user: null, clockOffsetMs: 0 });
});

describe('AppShell 闭关归来', () => {
  it('opens on a 战果 receipt older than the threshold, however short the settle was', async () => {
    shell();
    await waitFor(() => expect(useCharacterStore.getState().view).not.toBeNull());

    act(() => useZoneStore.getState().applyLoot(receipt(RETURN_THRESHOLD_MS + 30_000)));

    const panel = await screen.findByRole('dialog');
    expect(panel).toHaveTextContent('闭关归来');
    expect(panel).toHaveTextContent('挂机战果');
    expect(panel).toHaveTextContent('37');
    expect(panel).toHaveTextContent('修为 +1,200');
    expect(panel).toHaveTextContent('灵石 +195');
    // The receipt's own window, not the 6 seconds the settle credited.
    expect(panel).toHaveTextContent('离山 2分30秒');
  });

  it('greets a receipt that beats the boot settle home', async () => {
    let release = () => {};
    pending = {
      result: settleResult(),
      hold: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    shell();

    act(() => useZoneStore.getState().applyLoot(receipt(RETURN_THRESHOLD_MS + 30_000)));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(await screen.findByRole('dialog')).toHaveTextContent('挂机战果');
  });

  it('stays out of the way for the receipts a live session pushes every few seconds', async () => {
    const opened = Date.now();
    shell();
    await waitFor(() => expect(useCharacterStore.getState().view).not.toBeNull());

    // The player walks onto a map 10s in; the first flush lands 5s after that.
    vi.spyOn(Date, 'now').mockReturnValue(opened + 15_000);
    act(() =>
      useZoneStore.getState().applyLoot(receipt(0, { since: opened + 10_000, kills: 2, exp: 60 })),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // `store/zone.ts` keeps the earliest `since`, so an hour of farming leaves
    // the tally looking as old as a night away — but the session is that old
    // too, which is what tells the two apart.
    const hourIn = opened + 3_600_000;
    vi.spyOn(Date, 'now').mockReturnValue(hourIn);
    act(() =>
      useZoneStore.getState().applyLoot(receipt(0, { since: hourIn - 5_000, kills: 4, exp: 120 })),
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useZoneStore.getState().loot?.since).toBe(opened + 10_000);
  });

  it('lets a receipt update the panel a long 修炼 window already opened', async () => {
    pending = {
      result: settleResult({ elapsedSec: 9_000, creditedSec: 9_000 }),
      hold: Promise.resolve(),
    };
    shell();

    const panel = await screen.findByRole('dialog');
    expect(panel).toHaveTextContent('计入时长');
    expect(panel).not.toHaveTextContent('挂机战果');

    act(() => useZoneStore.getState().applyLoot(receipt(RETURN_THRESHOLD_MS + 30_000)));

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toHaveTextContent('挂机战果');
    expect(screen.getByRole('dialog')).toHaveTextContent('37');
    // The 修炼 window is the longer of the two here, so it names the absence.
    expect(screen.getByRole('dialog')).toHaveTextContent('离山 2小时30分');
  });

  it('keeps the tally in the store after 继续修行, for the 探索 HUD', async () => {
    shell();
    await waitFor(() => expect(useCharacterStore.getState().view).not.toBeNull());
    act(() => useZoneStore.getState().applyLoot(receipt(RETURN_THRESHOLD_MS + 30_000)));
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: '继续修行' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useZoneStore.getState().loot?.kills).toBe(37);

    // And it does not come back on the next receipt of the same session.
    act(() =>
      useZoneStore.getState().applyLoot(receipt(RETURN_THRESHOLD_MS + 60_000, { kills: 1 })),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
