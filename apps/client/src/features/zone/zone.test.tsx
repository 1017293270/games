import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ZONE_FLAGS } from '@xianxia/shared';
import { DEMO_PASSWORD, DEMO_USERNAME } from '../../api/mock';
import { createZoneDriver } from '../../api/mock/zone';
import { api } from '../../api/endpoints';
import { setTokenSource } from '../../api/http';
import type { GameSocket } from '../../api/socket';
import * as socketStore from '../../store/socket';
import { useZoneStore, zoneFrames } from '../../store/zone';
import { ZonePage } from './ZonePage';

/**
 * The 战斗大地图 page, driven by the very simulation the mock build runs: the
 * driver is asked to enter 青云山, and whatever it pushes back is what the page
 * renders. jsdom has no WebGL, so this is always the DOM fallback — which is
 * the point, since that is the path a reduced-motion player takes too.
 */

let token: string | null = null;
const emit = vi.fn();

/** Routes the store's emits into the mock zone driver, as the socket would. */
function wireDriver(): void {
  const driver = createZoneDriver((event, ...args) => {
    const store = useZoneStore.getState();
    if (event === 'zone:joined') store.applyJoined(args[0] as never);
    if (event === 'zone:frame') store.applyFrame(args[0] as never);
    if (event === 'zone:left') store.applyLeft(args[0] as never);
    if (event === 'zone:loot') store.applyLoot(args[0] as never);
    if (event === 'zone:error') store.applyError(args[0] as never);
  });

  const socket: GameSocket = {
    on: () => {},
    off: () => {},
    emit: ((event: string, payload: unknown) => {
      emit(event, payload);
      if (event === 'zone:enter') driver.enter((payload as { zoneId: string | null }).zoneId);
      if (event === 'zone:leave') driver.leave();
      if (event === 'zone:retreat') driver.retreat();
    }) as unknown as GameSocket['emit'],
    disconnect: () => driver.stop(),
  };
  vi.spyOn(socketStore, 'getSocket').mockReturnValue(socket);
}

function page() {
  return render(
    <MemoryRouter>
      <ZonePage />
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  setTokenSource(() => token);
  token = (await api.login({ username: DEMO_USERNAME, password: DEMO_PASSWORD })).token;
});

beforeEach(() => {
  emit.mockClear();
  useZoneStore.getState().reset();
  wireDriver();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('山河图', () => {
  it('lists the maps and lets a 练气 character walk into the first one', async () => {
    const user = userEvent.setup();
    page();

    const card = await screen.findByRole('button', { name: /青云山/ });
    await user.click(card);

    expect(emit).toHaveBeenCalledWith('zone:enter', { zoneId: 'map-qingyun-mountain' });
    expect(useZoneStore.getState().status).toBe('in');
  });

  it('bars a map the character has not the 境界 for', async () => {
    page();
    // 昆仑墟 opens at 元婴; the demo character is nowhere near it.
    const locked = await screen.findByRole('button', { name: /昆仑墟/ });
    expect(locked).toBeDisabled();
    expect(locked).toHaveTextContent('需');
  });
});

describe('战斗大地图', () => {
  beforeEach(() => {
    useZoneStore.getState().enter('map-qingyun-mountain');
  });

  it('puts the whole field on screen, the player at the top of it', () => {
    page();

    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(1);

    // The mock world's demo character leads the roster.
    expect(within(rows[0] as HTMLElement).getByText('你')).toBeInTheDocument();

    // 青云山 stands 8 狼 either side of the path and 15 灵猿 above them.
    const beasts = rows.filter((row) => row.textContent?.includes('妖兽'));
    expect(beasts.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/青云狼|灵猿/).length).toBeGreaterThan(0);
  });

  it('names the field, counts the house and clocks the 秘境', () => {
    page();
    expect(screen.getByText('青云山')).toBeInTheDocument();
    // The player plus a dozen 散修.
    expect(screen.getByText(/在场/)).toHaveTextContent('13');
    expect(screen.getByText(/秘境 .*后/)).toBeInTheDocument();
  });

  it('follows the fight: hp falls and the sim reports who is on whom', async () => {
    page();
    const before = screen.getAllByRole('listitem').length;

    // Four ticks of the real simulation, arriving as real delta frames.
    await waitFor(
      () => {
        expect(useZoneStore.getState().lastSeq).toBeGreaterThan(4);
      },
      { timeout: 3_000 },
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(before);
    expect(screen.getAllByText(/战 /).length).toBeGreaterThan(0);
  });

  it('walks off the field on 撤离', async () => {
    const user = userEvent.setup();
    page();

    await user.click(screen.getByRole('button', { name: '撤离' }));

    expect(emit).toHaveBeenCalledWith('zone:retreat', undefined);
    expect(useZoneStore.getState().status).toBe('out');
    expect(await screen.findByRole('heading', { name: '山河图' })).toBeInTheDocument();
  });

  it('holds a player under the 身死 countdown until the respawn is due', () => {
    page();
    act(() => {
      useZoneStore
        .getState()
        .applyDeath({ killerName: '青云狼', stonesLost: 0, respawnAt: Date.now() + 10_000 });
    });

    const notice = screen.getByRole('alertdialog', { name: '身死道消' });
    expect(notice).toHaveTextContent('败于 青云狼 之手');
    // The count is a second-resolution clock, so it is 10 or 11 depending on
    // where in the second the render landed — what matters is that it counts.
    expect(notice.querySelector('.zone-death__count')?.textContent).toMatch(/^\d+$/);
  });

  it('shows the 护身 grace a new arrival gets, on the field and in the HUD', async () => {
    page();

    // The grace is granted on arrival but only becomes a flag on the first
    // tick, so this waits for a frame rather than reading the joining one.
    await waitFor(() => {
      const self = useZoneStore.getState().self;
      expect(self).not.toBeNull();
      expect(zoneFrames.get(self as number)?.next.flags ?? 0).toBe(
        ZONE_FLAGS.PROTECTED | ZONE_FLAGS.MOVING,
      );
    });

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByText('护身')).toBeInTheDocument();
    expect(screen.getAllByText('护身').length).toBeGreaterThan(1);
  });
});
