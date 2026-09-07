import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { claim, draw, equip, get, history, upgrade } from './service.js';
export const progressionHandlers: HandlerRegistry = {
  'progression.get': handler(API.progression.get, get),
  'progression.draw': handler(API.progression.draw, draw),
  'progression.equip': handler(API.progression.equip, equip),
  'progression.upgrade': handler(API.progression.upgrade, upgrade),
  'progression.claim': handler(API.progression.claim, claim),
  'progression.history': handler(API.progression.history, history),
};
