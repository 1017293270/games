/**
 * The complete REST surface in one object.
 *
 * The server registers routes by walking `API`, and the client builds its
 * fetch wrapper from the same table — so a renamed path or a changed payload
 * is a compile error on both sides rather than a runtime 404.
 */

import { progressionEndpoints } from './progression.js';
import { authEndpoints } from './auth.js';
import { characterEndpoints } from './character.js';
import { inventoryEndpoints } from './inventory.js';
import { exploreEndpoints } from './explore.js';
import { arenaEndpoints, partyEndpoints, raidEndpoints, socialEndpoints } from './social.js';
import { npcEndpoints, questEndpoints, shopEndpoints } from './npc.js';
import { adminEndpoints } from './admin.js';
import type { Endpoint } from './common.js';

export const API = {
  auth: authEndpoints,
  progression: progressionEndpoints,
  character: characterEndpoints,
  inventory: inventoryEndpoints,
  explore: exploreEndpoints,
  party: partyEndpoints,
  social: socialEndpoints,
  arena: arenaEndpoints,
  raid: raidEndpoints,
  npc: npcEndpoints,
  quests: questEndpoints,
  shop: shopEndpoints,
  admin: adminEndpoints,
} as const;

export type ApiGroup = keyof typeof API;

/** Flat list of every endpoint, for route registration and docs generation. */
export function allEndpoints(): { group: string; name: string; endpoint: Endpoint }[] {
  const out: { group: string; name: string; endpoint: Endpoint }[] = [];
  for (const [group, endpoints] of Object.entries(API)) {
    for (const [name, def] of Object.entries(endpoints)) {
      out.push({ group, name, endpoint: def as Endpoint });
    }
  }
  return out;
}
