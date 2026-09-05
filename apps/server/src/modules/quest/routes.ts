import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwn } from '../../game/access.js';
import { acceptQuest, completeQuest, listQuests, syncAndSave } from './service.js';

/** `quests.*` handlers: 任务列表、接取与交付. */
export const questHandlers: HandlerRegistry = {
  'quests.list': handler(API.quests.list, (c) => {
    const { state } = loadOwn(c);
    return listQuests(syncAndSave(c.ctx, state));
  }),

  'quests.accept': handler(API.quests.accept, (c) => {
    const { state } = loadOwn(c);
    return acceptQuest(c.ctx, state, c.input.questId, c.now).list;
  }),

  'quests.complete': handler(API.quests.complete, (c) => {
    const { state } = loadOwn(c);
    return completeQuest(c.ctx, state, c.input.questId, c.world, c.now);
  }),
};
