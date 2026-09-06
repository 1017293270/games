import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwnHealed } from '../../game/hp.js';
import { chatHistory } from './service.js';

/** `social.*` handlers. 好友 arrives with the friends module. */
export const socialHandlers: HandlerRegistry = {
  'social.chatHistory': handler(API.social.chatHistory, (c) => {
    const query: {
      channel: typeof c.input.channel;
      limit: number;
      before?: number;
      partyId?: string;
    } = {
      channel: c.input.channel,
      limit: c.input.limit,
    };
    if (c.input.before !== undefined) query.before = c.input.before;
    if (c.input.partyId !== undefined) query.partyId = c.input.partyId;
    return chatHistory(c.ctx, loadOwnHealed(c).state.id, query);
  }),
};
