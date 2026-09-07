import { API, type RequestOf } from '@xianxia/shared';
import { call } from './http';

/**
 * Named wrappers over `API`. Every call site goes through here so the endpoint
 * table stays the only place a path or payload is written down.
 */
export const api = {
  progression: () => call(API.progression.get, {}),
  progressionDraw: (body: RequestOf<typeof API.progression.draw>) =>
    call(API.progression.draw, body),
  progressionEquip: (body: RequestOf<typeof API.progression.equip>) =>
    call(API.progression.equip, body),
  progressionUpgrade: (body: RequestOf<typeof API.progression.upgrade>) =>
    call(API.progression.upgrade, body),
  progressionClaim: (body: RequestOf<typeof API.progression.claim>) =>
    call(API.progression.claim, body),
  progressionHistory: () => call(API.progression.history, {}),
  register: (body: RequestOf<typeof API.auth.register>) => call(API.auth.register, body),
  login: (body: RequestOf<typeof API.auth.login>) => call(API.auth.login, body),
  logout: () => call(API.auth.logout, {}),
  me: () => call(API.auth.me, {}),

  createCharacter: (body: RequestOf<typeof API.character.create>) =>
    call(API.character.create, body),
  getCharacter: () => call(API.character.get, {}),
  settle: () => call(API.character.settle, {}),
  breakthrough: (pills: number) => call(API.character.breakthrough, { pills }),
  equipSkills: (slots: (string | null)[]) => call(API.character.equipSkills, { slots }),
  learnSkill: (skillId: string) => call(API.character.learnSkill, { skillId }),
  setTechnique: (techniqueId: string) => call(API.character.setTechnique, { techniqueId }),
  learnTechnique: (techniqueId: string) => call(API.character.learnTechnique, { techniqueId }),
  publicProfile: (id: string) => call(API.character.publicProfile, {}, { id }),
  rankings: (input: RequestOf<typeof API.character.rankings>) =>
    call(API.character.rankings, input),

  inventory: () => call(API.inventory.list, {}),
  useItem: (uid: string, qty = 1) => call(API.inventory.use, { uid, qty }),
  equipItem: (uid: string) => call(API.inventory.equip, { uid }),
  unequipItem: (slot: RequestOf<typeof API.inventory.unequip>['slot']) =>
    call(API.inventory.unequip, { slot }),

  exploreMaps: () => call(API.explore.maps, {}),
  exploreBattle: (input: RequestOf<typeof API.explore.battle>) => call(API.explore.battle, input),
  gather: (mapId: string) => call(API.explore.gather, { mapId }),
  chooseEncounter: (input: RequestOf<typeof API.explore.chooseEvent>) =>
    call(API.explore.chooseEvent, input),
  dungeons: () => call(API.explore.dungeons, {}),
  startDungeon: (input: RequestOf<typeof API.explore.startDungeon>) =>
    call(API.explore.startDungeon, input),

  chatHistory: (input: RequestOf<typeof API.social.chatHistory>) =>
    call(API.social.chatHistory, input),
  friends: () => call(API.social.friends, {}),
  friendRequest: (characterId: string) => call(API.social.friendRequest, { characterId }),
  friendAccept: (characterId: string) => call(API.social.friendAccept, { characterId }),
  friendRemove: (characterId: string) => call(API.social.friendRemove, { characterId }),

  party: () => call(API.party.get, {}),
  createParty: () => call(API.party.create, {}),
  joinParty: (code: string) => call(API.party.join, { code }),
  leaveParty: () => call(API.party.leave, {}),
  kickPartyMember: (characterId: string) => call(API.party.kick, { characterId }),

  arenaOpponents: () => call(API.arena.opponents, {}),
  arenaChallenge: (targetId: string) => call(API.arena.challenge, { targetId }),
  arenaRecords: (input: RequestOf<typeof API.arena.records>) => call(API.arena.records, input),

  raidTargets: () => call(API.raid.targets, {}),
  raidAttack: (input: RequestOf<typeof API.raid.attack>) => call(API.raid.attack, input),

  npcs: () => call(API.npc.list, {}),
  npcDialogue: (npcId: string) => call(API.npc.dialogue, { npcId }),
  npcTalk: (input: RequestOf<typeof API.npc.talk>) => call(API.npc.talk, input),

  quests: () => call(API.quests.list, {}),
  acceptQuest: (questId: string) => call(API.quests.accept, { questId }),
  completeQuest: (questId: string) => call(API.quests.complete, { questId }),

  shop: (shopId: string) => call(API.shop.list, { shopId }, { shopId }),
  shopBuy: (input: RequestOf<typeof API.shop.buy>) => call(API.shop.buy, input),
  shopSell: (input: RequestOf<typeof API.shop.sell>) => call(API.shop.sell, input),
} as const;
