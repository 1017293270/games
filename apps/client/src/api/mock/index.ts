/**
 * Wiring for `VITE_MOCK=1`: installs the HTTP transport and a socket shim so
 * the entire client can be exercised — and screenshotted — with no server.
 */

import {
  fail,
  getProgression,
  ok,
  stageName,
  type ApiResult,
  type ChatMessage,
  type ClientToServerEvents,
  type Endpoint,
  type ServerToClientEvents,
} from '@xianxia/shared';
import { setMockTransport } from '../http';
import { setSocketFactory, type GameSocket } from '../socket';
import { findHandler, makeCtx, MockFail } from './handlers';
import { startMultiplayerFeed } from './multiplayer';
import { buildView, emit, getWorld, isOnline, settleInto, statsFor } from './world';
import { createZoneDriver } from './zone';

export { DEMO_PASSWORD, DEMO_USERNAME, resetWorld } from './world';

/** Entry point called from `main.tsx` behind a dynamic import. */
export function installMock(): void {
  installMockTransport();
  setSocketFactory(() => createMockSocket());
  console.info('[mock] VITE_MOCK=1 — 本次运行不连服务器，全部数据由 src/api/mock 生成');
}

export function installMockTransport(): void {
  setMockTransport(
    async (endpoint: Endpoint, input, params, token): Promise<ApiResult<unknown>> => {
      // A touch of latency so loading states are real rather than theoretical.
      await new Promise((resolve) => setTimeout(resolve, 60));
      const handler = findHandler(endpoint);
      if (!handler) {
        return fail('NOT_FOUND', `mock 未实现 ${endpoint.method} ${endpoint.path}`);
      }
      const ctx = makeCtx(token);
      if (endpoint.auth !== 'none' && !ctx.user) {
        return fail('UNAUTHORIZED', '登录状态已失效，请重新登录');
      }
      try {
        return ok(handler(ctx, (input ?? {}) as Record<string, unknown>, params));
      } catch (error) {
        if (error instanceof MockFail) return fail(error.code, error.message);
        console.error('[mock] handler threw', endpoint.path, error);
        return fail('INTERNAL_ERROR', '模拟服务出错，详见控制台');
      }
    },
  );
}

const BOT_CHAT_LINES = [
  '幽冥谷今日雾浓，同去的道友报个数。',
  '有偿求一颗破境丹，价好商量。',
  '青云秘境刚清完，虎王掉了件法宝。',
  '论道台三连败，回去闭关了。',
  '灵草十株换玄铁精一块，可有意者？',
  '恭喜道友结丹，来日方长。',
  '这天劫看着就唬人，谁渡过？',
  '缺一个奶，洛水秘境走一波。',
];

type Listener = (...args: unknown[]) => void;

/** A socket-shaped object driven by the mock world's timers. */
export function createMockSocket(): GameSocket {
  const world = getWorld();
  const listeners = new Map<string, Set<Listener>>();

  const bridge = <K extends keyof ServerToClientEvents>(
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void => {
    for (const fn of listeners.get(event) ?? []) fn(...(args as unknown[]));
  };
  world.listeners.add(bridge as never);

  // 围攻 blood pools, one inbound 论道 and one friend request.
  const stopMultiplayerFeed = startMultiplayerFeed();

  // The 战斗大地图, run in-browser off the shared simulation core.
  const zone = createZoneDriver(bridge);

  const bots = [...world.characters.values()].filter((c) => c.isBot);
  const onlineCount = () => bots.filter(isOnline).length + 1;

  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    const bot = bots[Math.floor(Math.random() * bots.length)];
    if (!bot) return;

    if (tick % 3 === 0) {
      const text = BOT_CHAT_LINES[Math.floor(Math.random() * BOT_CHAT_LINES.length)] ?? '……';
      const message: ChatMessage = {
        id: `chat-${Date.now().toString(36)}`,
        channel: 'world',
        senderId: bot.id,
        senderName: bot.name,
        senderStageName: stageName(bot.stageIndex),
        text,
        sentAt: Date.now(),
      };
      world.chat.push(message);
      bridge('chat:message', message);
    }

    if (tick % 4 === 0) {
      bridge('system:notice', {
        kind: 'breakthrough',
        text: `${bot.name} 突破至 ${stageName(Math.min(35, bot.stageIndex + 1))}`,
        characterId: bot.id,
        at: Date.now(),
      });
    }

    if (tick % 5 === 0) {
      bridge('presence:update', {
        characterId: bot.id,
        name: bot.name,
        online: true,
        onlineCount: onlineCount(),
      });
    }
  }, 7000);

  // Push the same incremental patch the server sends after a settle tick.
  const settleTimer = setInterval(() => {
    for (const [token, userId] of world.tokens) {
      void token;
      const user = world.usersById.get(userId);
      const char = user?.characterId ? world.characters.get(user.characterId) : null;
      if (!char) continue;
      const settled = settleInto(world, char).character;
      const inv = world.inventories.get(char.id) ?? [];
      const next = { ...settled, powerScore: statsFor(settled, inv).power };
      world.characters.set(next.id, next);
      bridge('character:update', {
        id: next.id,
        exp: next.exp,
        stageIndex: next.stageIndex,
        powerScore: next.powerScore,
        stageName: stageName(next.stageIndex),
      });
      break;
    }
  }, 20_000);

  return {
    on(event, fn) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(fn as Listener);
      listeners.set(event, set);
    },
    off(event, fn) {
      if (!fn) listeners.delete(event);
      else listeners.get(event)?.delete(fn as Listener);
    },
    emit(event, ...args) {
      if (event === 'zone:enter') {
        const payload = args[0] as Parameters<ClientToServerEvents['zone:enter']>[0];
        zone.enter(payload.zoneId);
        return;
      }
      if (event === 'zone:leave') {
        zone.leave();
        return;
      }
      if (event === 'zone:retreat') {
        zone.retreat();
        return;
      }
      if (event !== 'chat:send') return;
      const payload = args[0] as Parameters<ClientToServerEvents['chat:send']>[0];
      const [firstToken] = [...world.tokens.keys()];
      const userId = firstToken ? world.tokens.get(firstToken) : undefined;
      const user = userId ? world.usersById.get(userId) : undefined;
      const char = user?.characterId ? world.characters.get(user.characterId) : undefined;
      const message: ChatMessage = {
        id: `chat-${Date.now().toString(36)}`,
        channel: payload.channel,
        senderId: char?.id ?? null,
        senderName: char?.name ?? '无名',
        senderStageName: char ? stageName(char.stageIndex) : null,
        text: payload.text,
        sentAt: Date.now(),
      };
      if (char) {
        const progression = getProgression(char.progression, Date.now());
        progression.daily.chat++;
        world.characters.set(char.id, { ...char, progression });
      }
      world.chat.push(message);
      bridge('chat:message', message);
    },
    disconnect() {
      clearInterval(timer);
      clearInterval(settleTimer);
      stopMultiplayerFeed();
      zone.stop();
      world.listeners.delete(bridge as never);
      listeners.clear();
    },
  };
}

/** Test/debug helper: force a system broadcast through the mock socket. */
export function broadcastNotice(text: string): void {
  emit(getWorld(), 'system:notice', {
    kind: 'announcement',
    text,
    characterId: null,
    at: Date.now(),
  });
}

export { buildView, getWorld };
