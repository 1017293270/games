import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwnHealed } from '../../game/hp.js';
import { createParty, currentParty, joinParty, kickMember, leaveParty } from './service.js';

/** `party.*` handlers. */
export const partyHandlers: HandlerRegistry = {
  'party.get': handler(API.party.get, (c) => ({
    party: currentParty(c.ctx, loadOwnHealed(c).state.id),
  })),

  'party.create': handler(API.party.create, (c) =>
    createParty(c.ctx, loadOwnHealed(c).state, c.world.maxPartySize, c.now),
  ),

  'party.join': handler(API.party.join, (c) =>
    joinParty(c.ctx, loadOwnHealed(c).state, c.input.code),
  ),

  'party.leave': handler(API.party.leave, (c) => leaveParty(c.ctx, loadOwnHealed(c).state)),

  'party.kick': handler(API.party.kick, (c) =>
    kickMember(c.ctx, loadOwnHealed(c).state, c.input.characterId),
  ),
};
