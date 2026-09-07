import {
  API,
  ProgressionError,
  getProgression,
  claimProgression,
  drawProgression,
  equipProgression,
  upgradeProgression,
  hashSeed,
  type GachaHistoryEntry,
  type ProgressionResponse,
} from '@xianxia/shared';
import type { Ctx, Handler } from './handlers';
import { buildView, type MockWorld } from './world';

type Receipt = { input: string; results: GachaHistoryEntry['results'] };
const worlds = new WeakMap<
  MockWorld,
  { receipts: Map<string, Receipt>; history: Map<string, GachaHistoryEntry[]> }
>();

export function registerProgressionHandlers(kit: {
  on: (endpoint: (typeof API.progression)[keyof typeof API.progression], handler: Handler) => void;
  save: (ctx: Ctx, char: NonNullable<Ctx['char']>) => NonNullable<Ctx['char']>;
  Fail: new (code: ProgressionError['code'], message: string) => Error;
}): void {
  for (const [name, endpoint] of Object.entries(API.progression))
    kit.on(endpoint, (ctx, input) => {
      if (!ctx.char) throw new kit.Fail('CHARACTER_NOT_FOUND', '尚未创建角色');
      let cache = worlds.get(ctx.w);
      if (!cache) {
        cache = { receipts: new Map(), history: new Map() };
        worlds.set(ctx.w, cache);
      }
      const history = cache.history.get(ctx.char.id) ?? [];
      if (name === 'history') return { items: history };
      let progression = getProgression(ctx.char.progression, ctx.now);
      let results: ProgressionResponse['results'];
      try {
        if (name === 'draw') {
          const request = API.progression.draw.request.parse(input);
          const key = `${ctx.char.id}:${request.requestId}`;
          const receipt = cache.receipts.get(key);
          const signature = JSON.stringify(request);
          if (receipt) {
            if (receipt.input !== signature)
              throw new kit.Fail('CONDITION_UNMET', '请求编号已用于其他寻宝');
            results = receipt.results;
          } else {
            ({ progression, results } = drawProgression(
              progression,
              request,
              hashSeed(key),
              ctx.now,
            ));
            cache.receipts.set(key, { input: signature, results });
            cache.history.set(
              ctx.char.id,
              [{ id: key, requestId: request.requestId, at: ctx.now, results }, ...history].slice(
                0,
                100,
              ),
            );
          }
        } else if (name === 'claim')
          progression = claimProgression(
            progression,
            API.progression.claim.request.parse(input),
            ctx.now,
          );
        else if (name === 'equip')
          progression = equipProgression(progression, API.progression.equip.request.parse(input));
        else if (name === 'upgrade')
          progression = upgradeProgression(
            progression,
            API.progression.upgrade.request.parse(input),
          );
      } catch (error) {
        if (error instanceof ProgressionError) throw new kit.Fail(error.code, error.message);
        throw error;
      }
      const char = kit.save(ctx, { ...ctx.char, progression });
      return { view: buildView(ctx.w, char), progression, ...(results ? { results } : {}) };
    });
}
