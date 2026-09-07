import { transact } from '../../db/index.js';
import { progressEvent } from '../../game/progression.js';
import { randomUUID } from 'node:crypto';
import {
  stageName,
  type CharacterState,
  type ChatChannel,
  type ChatMessage,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';

/**
 * Chat.
 *
 * Live delivery is Socket.IO; this module owns the transcript, so a client that
 * reconnects can pull the scrollback it missed.
 */

/** Per-sender rate limit: one line a second. */
export const CHAT_MIN_INTERVAL_MS = 1000;

export function chatHistory(
  ctx: AppContext,
  characterId: string,
  input: { channel: ChatChannel; limit: number; before?: number; partyId?: string },
): { messages: ChatMessage[] } {
  // 队伍频道 is readable only from inside the party, and only the party the
  // caller is actually in — an id from the request body proves nothing.
  if (input.channel === 'party') {
    const record = ctx.parties.byMember(characterId);
    if (!record) throw new ApiError('NOT_IN_PARTY', '你还没有队伍');
    if (input.partyId !== undefined && input.partyId !== record.id) {
      throw new ApiError('FORBIDDEN', '你不在这支队伍里');
    }
    return { messages: ctx.chat.history('party', input.limit, input.before, record.id) };
  }
  return { messages: ctx.chat.history(input.channel, input.limit, input.before) };
}

/** Builds, stores and trims a chat line. Broadcasting is the caller's job. */
export function recordMessage(
  ctx: AppContext,
  message: {
    channel: ChatChannel;
    senderId: string | null;
    senderName: string;
    stageIndex: number | null;
    text: string;
  },
  world: WorldSettings,
  now: number,
  partyId: string | null = null,
): ChatMessage {
  const stored: ChatMessage = {
    id: randomUUID(),
    channel: message.channel,
    senderId: message.senderId,
    senderName: message.senderName,
    senderStageName: message.stageIndex === null ? null : stageName(message.stageIndex),
    text: message.text,
    sentAt: now,
  };

  let updated: CharacterState | undefined;
  transact(ctx.db, () => {
    ctx.chat.insert(stored, partyId);
    ctx.counters.bump('chat', now);
    if (message.senderId) {
      const fresh = ctx.characters.byId(message.senderId);
      if (fresh && !fresh.isBot) {
        const next = progressEvent(fresh, now, 'chat');
        ctx.characters.save(next);
        updated = next;
      }
    }

    // Trimming on write keeps the table at `chatHistoryLimit` without a sweeper.
    // 队伍频道 is trimmed inside its own party, so the cap is per scrollback.
    if (world.chatHistoryLimit > 0) {
      if (partyId === null) ctx.chat.trim(message.channel, world.chatHistoryLimit);
      else ctx.chat.trim(message.channel, world.chatHistoryLimit, partyId);
    }
  });
  if (updated) ctx.realtime.characterUpdate(updated);
  return stored;
}
