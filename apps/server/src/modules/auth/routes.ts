import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { ApiError, MESSAGES } from '../../http/errors.js';
import { login, me, register } from './service.js';

/** `auth.*` handlers. */
export const authHandlers: HandlerRegistry = {
  'auth.register': handler(API.auth.register, (c) => register(c.ctx, c.input, c.now)),

  'auth.login': handler(API.auth.login, (c) => login(c.ctx, c.input, c.now)),

  'auth.logout': handler(API.auth.logout, (c) => {
    if (c.identity) c.ctx.sessions.remove(c.identity.token);
    return {};
  }),

  'auth.me': handler(API.auth.me, (c) => {
    if (!c.identity) throw new ApiError('UNAUTHORIZED', MESSAGES.UNAUTHORIZED);
    const character = c.ctx.characters.byUserId(c.identity.user.id);
    if (character) c.ctx.characters.touchSeen(character.id, c.now);
    return me(c.ctx, c.identity.user, c.now);
  }),
};
