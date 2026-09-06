import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@xianxia/shared';
import { useChatStore } from './chat';

function line(id: string, channel: ChatMessage['channel'], text = '……'): ChatMessage {
  return {
    id,
    channel,
    senderId: 'char-demo',
    senderName: '演示',
    senderStageName: '练气一层',
    text,
    sentAt: Date.now(),
  };
}

beforeEach(() => {
  useChatStore.getState().reset();
});

describe('chat store', () => {
  it('files each channel in its own transcript, with 谕 counted as world news', () => {
    const chat = useChatStore.getState();
    chat.push(line('w1', 'world', '有人渡劫'));
    chat.push(line('p1', 'party', '走一趟秘境'));
    chat.pushNotice({ kind: 'breakthrough', text: '某某突破', characterId: 'bot-1', at: 1 });

    const { messages } = useChatStore.getState();
    expect(messages.world.map((m) => m.id)).toEqual(['w1', expect.stringContaining('notice-')]);
    expect(messages.party.map((m) => m.id)).toEqual(['p1']);
  });

  it('ignores a message it is already holding', () => {
    useChatStore.getState().push(line('w1', 'world'));
    useChatStore.getState().push(line('w1', 'world'));
    expect(useChatStore.getState().messages.world).toHaveLength(1);
  });

  it('drops the 队伍 transcript when the party changes', () => {
    useChatStore.getState().syncParty('party-a');
    useChatStore.getState().push(line('p1', 'party'));
    expect(useChatStore.getState().messages.party).toHaveLength(1);

    useChatStore.getState().syncParty('party-b');
    expect(useChatStore.getState().messages.party).toHaveLength(0);
    expect(useChatStore.getState().loaded.party).toBe(false);
  });

  it('sends the panel back to 世界 when the party ends', () => {
    useChatStore.getState().syncParty('party-a');
    useChatStore.getState().setChannel('party');
    useChatStore.getState().syncParty(null);
    expect(useChatStore.getState().channel).toBe('world');
  });

  it('leaves the 队伍 transcript alone while the party holds', () => {
    useChatStore.getState().syncParty('party-a');
    useChatStore.getState().push(line('p1', 'party'));
    useChatStore.getState().syncParty('party-a');
    expect(useChatStore.getState().messages.party).toHaveLength(1);
  });

  it('does not ask for 队伍 scrollback without a party to ask about', async () => {
    await useChatStore.getState().loadHistory('party');
    expect(useChatStore.getState().loaded.party).toBe(false);
  });
});
