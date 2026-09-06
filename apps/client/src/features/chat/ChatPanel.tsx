import { useEffect, useRef, useState } from 'react';
import { Button } from '../../design';
import { useCharacterStore } from '../../store/character';
import { useChatStore, type ReadableChannel } from '../../store/chat';
import { usePartyStore } from '../../store/party';
import { useUiStore } from '../../store/ui';
import '../social/social.css';

function clockOf(sentAt: number): string {
  return new Date(sentAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const CHANNEL_LABEL: Record<ReadableChannel, string> = { world: '世界', party: '队伍' };
const EMPTY_TEXT: Record<ReadableChannel, string> = {
  world: '世界频道一片安静。',
  party: '队中还没有人开口。',
};

/**
 * 世界 and 队伍 in one panel.
 *
 * Both channels are written down server-side, so each opens on its own
 * scrollback rather than on whatever arrived since the page loaded. 队伍 exists
 * only while there is a party to have one.
 */
export function ChatPanel() {
  const channel = useChatStore((state) => state.channel);
  const messages = useChatStore((state) => state.messages[state.channel]);
  const loaded = useChatStore((state) => state.loaded[state.channel]);
  const setChannel = useChatStore((state) => state.setChannel);
  const syncParty = useChatStore((state) => state.syncParty);
  const loadHistory = useChatStore((state) => state.loadHistory);
  const send = useChatStore((state) => state.send);
  const partyId = usePartyStore((state) => state.party?.id ?? null);
  const openProfile = useUiStore((state) => state.openProfile);
  const selfId = useCharacterStore((state) => state.view?.character.id ?? null);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement | null>(null);

  // The 队伍 transcript belongs to one party; leaving or joining another drops
  // it, which also sends the panel back to 世界 when there is no party left.
  useEffect(() => {
    syncParty(partyId);
  }, [partyId, syncParty]);

  useEffect(() => {
    if (!loaded) void loadHistory(channel);
  }, [channel, loaded, loadHistory]);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    send(draft);
    setDraft('');
  };

  const channels: ReadableChannel[] = partyId === null ? ['world'] : ['world', 'party'];

  return (
    <div className="chat">
      {channels.length > 1 && (
        <div className="chat__channels" role="tablist" aria-label="频道">
          {channels.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={channel === id}
              className={`chat__channel ${channel === id ? 'chat__channel--on' : ''}`}
              onClick={() => setChannel(id)}
            >
              {CHANNEL_LABEL[id]}
            </button>
          ))}
        </div>
      )}

      <div className="chat__log" ref={logRef}>
        {messages.length === 0 && <p className="empty">{EMPTY_TEXT[channel]}</p>}
        {messages.map((message) =>
          message.channel === 'system' ? (
            <p className="notice" key={message.id}>
              <span className="notice__seal">谕</span>
              {message.text}
            </p>
          ) : (
            <div
              className={`msg ${message.senderId === selfId ? 'msg--mine' : ''}`}
              key={message.id}
            >
              <div className="msg__head">
                <button
                  type="button"
                  className="msg__who"
                  onClick={() => message.senderId && openProfile(message.senderId)}
                >
                  {message.senderName}
                </button>
                {message.senderStageName && (
                  <span className="msg__stage">{message.senderStageName}</span>
                )}
                <span className="numeral">{clockOf(message.sentAt)}</span>
              </div>
              <p className="msg__body">{message.text}</p>
            </div>
          ),
        )}
      </div>

      <form className="chat__compose" onSubmit={submit}>
        <input
          className="field__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="传音入密，不过二百字"
          maxLength={200}
          aria-label={`${CHANNEL_LABEL[channel]}频道发言`}
        />
        <Button variant="primary" type="submit" disabled={!draft.trim()}>
          传音
        </Button>
      </form>
    </div>
  );
}
