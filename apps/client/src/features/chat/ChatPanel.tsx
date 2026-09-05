import { useEffect, useRef, useState } from 'react';
import { Button } from '../../design';
import { useCharacterStore } from '../../store/character';
import { useChatStore } from '../../store/chat';
import { useUiStore } from '../../store/ui';
import '../social/social.css';

function clockOf(sentAt: number): string {
  return new Date(sentAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function ChatPanel() {
  const messages = useChatStore((state) => state.messages);
  const loaded = useChatStore((state) => state.loaded);
  const loadHistory = useChatStore((state) => state.loadHistory);
  const send = useChatStore((state) => state.send);
  const openProfile = useUiStore((state) => state.openProfile);
  const selfId = useCharacterStore((state) => state.view?.character.id ?? null);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loaded) void loadHistory();
  }, [loaded, loadHistory]);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    send(draft);
    setDraft('');
  };

  return (
    <div className="chat">
      <div className="chat__log" ref={logRef}>
        {messages.length === 0 && <p className="empty">世界频道一片安静。</p>}
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
          aria-label="世界频道发言"
        />
        <Button variant="primary" type="submit" disabled={!draft.trim()}>
          传音
        </Button>
      </form>
    </div>
  );
}
