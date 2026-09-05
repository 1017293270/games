import { randomUUID } from 'node:crypto';
import {
  stageName,
  type ChatChannel,
  type ChatMessage,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';

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
  input: { channel: ChatChannel; limit: number; before?: number },
): { messages: ChatMessage[] } {
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

  ctx.chat.insert(stored, partyId);
  ctx.counters.bump('chat', now);

  // Trimming on write keeps the table at `chatHistoryLimit` without a sweeper.
  if (world.chatHistoryLimit > 0) ctx.chat.trim(message.channel, world.chatHistoryLimit);

  return stored;
}
