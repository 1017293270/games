import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwn } from '../../game/access.js';
import { syncAndSave } from '../quest/service.js';
import { listNpcs, startDialogue, talk } from './service.js';

/** `npc.*` handlers: 青云镇名录与对话树. */
export const npcHandlers: HandlerRegistry = {
  'npc.list': handler(API.npc.list, (c) => {
    const { state } = loadOwn(c);
    return listNpcs(syncAndSave(c.ctx, state));
  }),

  'npc.dialogue': handler(API.npc.dialogue, (c) => {
    const { state } = loadOwn(c);
    return startDialogue(c.ctx, state, c.input.npcId, c.world, c.now);
  }),

  'npc.talk': handler(API.npc.talk, (c) => {
    const { state } = loadOwn(c);
    const input: { npcId: string; nodeId: string; choiceId?: string } = {
      npcId: c.input.npcId,
      nodeId: c.input.nodeId,
    };
    if (c.input.choiceId !== undefined) input.choiceId = c.input.choiceId;
    return talk(c.ctx, state, input, c.world, c.now);
  }),
};
