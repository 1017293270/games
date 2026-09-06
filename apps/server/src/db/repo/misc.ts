import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  BOT_ARCHETYPES,
  BotArchetypeSchema,
  dayKey,
  type BotArchetype,
  type ChatMessage,
} from '@xianxia/shared';
import type { BattleResult } from '@xianxia/shared';

/** Server-wide key/value config; `world` holds the `WorldSettings` blob. */
export class SettingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(key: string): unknown {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      | { value_json: string }
      | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value_json);
    } catch {
      return undefined;
    }
  }

  put(key: string, value: unknown, now: number): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)' +
          ' ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,' +
          ' updated_at = excluded.updated_at',
      )
      .run(key, JSON.stringify(value), now);
  }
}

interface RawArchetype {
  id: string;
  name: string;
  description: string;
  params_json: string;
  weight: number;
  avatar_pool_json: string;
}

/**
 * Bot archetypes. Seeded from the shared content table on first boot so the
 * admin panel can retune them without a redeploy; the shared table stays the
 * definition of the *defaults*.
 */
export class ArchetypeRepo {
  constructor(private readonly db: DatabaseSync) {}

  seedIfEmpty(now: number): void {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM bot_archetypes').get() as { c: number };
    if (Number(row.c) > 0) return;
    for (const archetype of BOT_ARCHETYPES) this.upsert(archetype, now);
  }

  upsert(archetype: BotArchetype, now: number): void {
    this.db
      .prepare(
        'INSERT INTO bot_archetypes (id, name, description, params_json, weight,' +
          ' avatar_pool_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)' +
          ' ON CONFLICT(id) DO UPDATE SET name = excluded.name,' +
          ' description = excluded.description, params_json = excluded.params_json,' +
          ' weight = excluded.weight, avatar_pool_json = excluded.avatar_pool_json,' +
          ' updated_at = excluded.updated_at',
      )
      .run(
        archetype.id,
        archetype.name,
        archetype.description,
        JSON.stringify(archetype.params),
        archetype.weight,
        JSON.stringify(archetype.avatarPool),
        now,
      );
  }

  all(): BotArchetype[] {
    const rows = this.db
      .prepare('SELECT * FROM bot_archetypes ORDER BY weight DESC, id')
      .all() as unknown as RawArchetype[];
    return rows.map((row) =>
      BotArchetypeSchema.parse({
        id: row.id,
        name: row.name,
        description: row.description,
        params: JSON.parse(row.params_json),
        weight: Number(row.weight),
        avatarPool: JSON.parse(row.avatar_pool_json),
      }),
    );
  }

  byId(id: string): BotArchetype | null {
    return this.all().find((a) => a.id === id) ?? null;
  }
}

export class ChatRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(message: ChatMessage, partyId: string | null = null): void {
    this.db
      .prepare(
        'INSERT INTO chat_messages (id, channel, sender_id, sender_name, sender_stage_name,' +
          ' party_id, text, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        message.id,
        message.channel,
        message.senderId,
        message.senderName,
        message.senderStageName,
        partyId,
        message.text,
        message.sentAt,
      );
  }

  /**
   * Oldest-first slice of a channel, optionally older than `before`.
   *
   * `partyId` narrows 队伍频道 to one party — without it a member would read
   * every other party's talk, which is why the caller has to establish
   * membership before asking.
   */
  history(
    channel: string,
    limit: number,
    before?: number,
    partyId?: string,
  ): ChatMessage[] {
    const scope = partyId === undefined ? '' : ' AND party_id = ?';
    const scopeArgs = partyId === undefined ? [] : [partyId];
    const rows = (
      before === undefined
        ? this.db
            .prepare(
              `SELECT * FROM chat_messages WHERE channel = ?${scope}` +
                ' ORDER BY sent_at DESC, rowid DESC LIMIT ?',
            )
            .all(channel, ...scopeArgs, limit)
        : this.db
            .prepare(
              `SELECT * FROM chat_messages WHERE channel = ?${scope} AND sent_at < ?` +
                ' ORDER BY sent_at DESC, rowid DESC LIMIT ?',
            )
            .all(channel, ...scopeArgs, before, limit)
    ) as {
      id: string;
      channel: string;
      sender_id: string | null;
      sender_name: string;
      sender_stage_name: string | null;
      text: string;
      sent_at: number;
    }[];

    return rows
      .map((row) => ({
        id: row.id,
        channel: row.channel as ChatMessage['channel'],
        senderId: row.sender_id,
        senderName: row.sender_name,
        senderStageName: row.sender_stage_name,
        text: row.text,
        sentAt: Number(row.sent_at),
      }))
      .reverse();
  }

  /**
   * Keeps the newest `limit` messages per channel — and, for 队伍频道, per
   * party, so one talkative party cannot evict another's scrollback.
   */
  trim(channel: string, limit: number, partyId?: string): void {
    const scope = partyId === undefined ? '' : ' AND party_id = ?';
    const scopeArgs = partyId === undefined ? [] : [partyId];
    this.db
      .prepare(
        `DELETE FROM chat_messages WHERE channel = ?${scope} AND id NOT IN` +
          ` (SELECT id FROM chat_messages WHERE channel = ?${scope}` +
          ' ORDER BY sent_at DESC, rowid DESC LIMIT ?)',
      )
      .run(channel, ...scopeArgs, channel, ...scopeArgs, Math.max(0, limit));
  }

  countSince(since: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM chat_messages WHERE sent_at >= ?')
      .get(since) as { c: number };
    return Number(row.c);
  }
}

export interface BattleRecordInput {
  kind: 'arena' | 'raid' | 'dungeon' | 'explore' | 'tribulation';
  attackerId: string;
  attackerName: string;
  defenderId: string;
  defenderName: string;
  winnerId: string | null;
  ratingDelta: number;
  foughtAt: number;
  battle: BattleResult | null;
}

export class BattleRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(input: BattleRecordInput): string {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO battle_records (id, kind, attacker_id, attacker_name, defender_id,' +
          ' defender_name, winner_id, rating_delta, fought_at, battle_json)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.kind,
        input.attackerId,
        input.attackerName,
        input.defenderId,
        input.defenderName,
        input.winnerId,
        Math.round(input.ratingDelta),
        input.foughtAt,
        input.battle === null ? null : JSON.stringify(input.battle),
      );
    return id;
  }

  countSince(since: number, kind?: BattleRecordInput['kind']): number {
    const row = (
      kind === undefined
        ? this.db.prepare('SELECT COUNT(*) AS c FROM battle_records WHERE fought_at >= ?').get(since)
        : this.db
            .prepare('SELECT COUNT(*) AS c FROM battle_records WHERE fought_at >= ? AND kind = ?')
            .get(since, kind)
    ) as { c: number };
    return Number(row.c);
  }

  /** Drops records older than `before`, keeping the replay store bounded. */
  purgeBefore(before: number): number {
    const result = this.db.prepare('DELETE FROM battle_records WHERE fought_at < ?').run(before);
    return Number(result.changes);
  }
}

/** Server-wide UTC-day tallies backing the admin dashboard. */
export class CounterRepo {
  constructor(private readonly db: DatabaseSync) {}

  bump(key: string, at: number, by = 1): void {
    this.db
      .prepare(
        'INSERT INTO daily_counters (day, key, value) VALUES (?, ?, ?)' +
          ' ON CONFLICT(day, key) DO UPDATE SET value = value + excluded.value',
      )
      .run(dayKey(at), key, by);
  }

  get(key: string, at: number): number {
    const row = this.db
      .prepare('SELECT value FROM daily_counters WHERE day = ? AND key = ?')
      .get(dayKey(at), key) as { value: number } | undefined;
    return row ? Number(row.value) : 0;
  }
}
