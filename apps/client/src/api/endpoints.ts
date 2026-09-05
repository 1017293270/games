import { API, type RequestOf } from '@xianxia/shared';
import { call } from './http';

/**
 * Named wrappers over `API`. Every call site goes through here so the endpoint
 * table stays the only place a path or payload is written down.
 */
export const api = {
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

  chatHistory: (input: RequestOf<typeof API.social.chatHistory>) =>
    call(API.social.chatHistory, input),
  friends: () => call(API.social.friends, {}),
} as const;
