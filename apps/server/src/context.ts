import type { DatabaseSync } from 'node:sqlite';
import type { Encounter } from '@xianxia/shared';
import type { ServerConfig } from './config.js';
import { CharacterRepo } from './db/repo/characters.js';
import { InventoryRepo } from './db/repo/inventory.js';
import { InviteRepo } from './db/repo/invites.js';
import { AdminSessionRepo, SessionRepo } from './db/repo/sessions.js';
import { UserRepo } from './db/repo/users.js';
import { ArchetypeRepo, BattleRepo, ChatRepo, CounterRepo, SettingsRepo } from './db/repo/misc.js';
import { SettingsStore } from './game/settings.js';
import { PresenceTracker } from './game/presence.js';
import { Realtime } from './realtime.js';
import { BotEngine } from './engine/bots/engine.js';
import { PartyStore } from './modules/party/store.js';
import { FriendRepo } from './modules/friend/repo.js';
import { DungeonRunRepo } from './modules/dungeon/repo.js';

/**
 * A pending 奇遇 waiting for the player's choice.
 *
 * These live in memory on purpose: an encounter is a single round trip, and a
 * restart simply invalidates the token, which the endpoint reports as
 * `ENCOUNTER_NOT_ACTIVE`.
 */
export interface PendingEncounter {
  characterId: string;
  encounter: Encounter;
  mapId: string;
  expiresAt: number;
}

/** Encounter tokens, swept lazily on each lookup. */
export class EncounterStore {
  private readonly pending = new Map<string, PendingEncounter>();

  put(token: string, entry: PendingEncounter): void {
    this.pending.set(token, entry);
  }

  take(token: string, characterId: string, now: number): PendingEncounter | null {
    this.sweep(now);
    const entry = this.pending.get(token);
    if (!entry || entry.characterId !== characterId) return null;
    this.pending.delete(token);
    return entry;
  }

  private sweep(now: number): void {
    for (const [token, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(token);
    }
  }

  get size(): number {
    return this.pending.size;
  }
}

/** Everything a handler may reach for. Built once in `buildApp`. */
export interface AppContext {
  config: ServerConfig;
  db: DatabaseSync;
  /** Injectable clock. Tests advance it to exercise offline settlement. */
  now: () => number;
  version: string;
  startedAt: number;

  users: UserRepo;
  sessions: SessionRepo;
  adminSessions: AdminSessionRepo;
  invites: InviteRepo;
  characters: CharacterRepo;
  inventory: InventoryRepo;
  settingsRepo: SettingsRepo;
  archetypes: ArchetypeRepo;
  chat: ChatRepo;
  battles: BattleRepo;
  counters: CounterRepo;
  friends: FriendRepo;
  dungeonRuns: DungeonRunRepo;

  settings: SettingsStore;
  presence: PresenceTracker;
  realtime: Realtime;
  encounters: EncounterStore;
  /** Live parties. In memory: a party lasts one session (see `PartyStore`). */
  parties: PartyStore;
  /** The bot world loop. Assigned during `createContext`. */
  bots: BotEngine;
}

/** Wires the repositories and stores over an open database. */
export function createContext(options: {
  config: ServerConfig;
  db: DatabaseSync;
  now: () => number;
  version: string;
}): AppContext {
  const { config, db, now, version } = options;
  const settingsRepo = new SettingsRepo(db);
  const presence = new PresenceTracker();

  // The engine takes the context it lives in, so it is attached right after the
  // object exists rather than being threaded through every call site.
  const ctx: AppContext = {
    config,
    db,
    now,
    version,
    startedAt: now(),

    users: new UserRepo(db),
    sessions: new SessionRepo(db),
    adminSessions: new AdminSessionRepo(db),
    invites: new InviteRepo(db),
    characters: new CharacterRepo(db),
    inventory: new InventoryRepo(db),
    settingsRepo,
    archetypes: new ArchetypeRepo(db),
    chat: new ChatRepo(db),
    battles: new BattleRepo(db),
    counters: new CounterRepo(db),
    friends: new FriendRepo(db),
    dungeonRuns: new DungeonRunRepo(db),

    settings: new SettingsStore(settingsRepo, now),
    presence,
    realtime: new Realtime(presence),
    encounters: new EncounterStore(),
    parties: new PartyStore(),
    bots: null as unknown as BotEngine,
  };

  ctx.bots = new BotEngine(ctx);
  return ctx;
}
