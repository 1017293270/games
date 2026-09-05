import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwnHealed } from '../../game/hp.js';
import { acceptFriend, listFriends, removeFriend, requestFriend } from './service.js';

/**
 * `social.friends` / `friendRequest` / `friendAccept` / `friendRemove`.
 *
 * Kept out of the social module because 好友 owns a table and a push event of
 * its own, while `social` is only the chat transcript.
 */
export const friendHandlers: HandlerRegistry = {
  'social.friends': handler(API.social.friends, (c) =>
    listFriends(c.ctx, loadOwnHealed(c).state.id),
  ),

  'social.friendRequest': handler(API.social.friendRequest, (c) =>
    requestFriend(c.ctx, loadOwnHealed(c).state, c.input.characterId, c.now),
  ),

  'social.friendAccept': handler(API.social.friendAccept, (c) =>
    acceptFriend(c.ctx, loadOwnHealed(c).state, c.input.characterId, c.now),
  ),

  'social.friendRemove': handler(API.social.friendRemove, (c) =>
    removeFriend(c.ctx, loadOwnHealed(c).state, c.input.characterId),
  ),
};
