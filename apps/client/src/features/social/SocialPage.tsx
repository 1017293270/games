import { useState } from 'react';
import { CloudRule } from '../../design';
import { ChatPanel } from '../chat/ChatPanel';
import { RankingsPanel } from '../rankings/RankingsPanel';
import './social.css';

type Tab = 'chat' | 'ranks' | 'friends';

const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: '世界' },
  { id: 'ranks', label: '榜单' },
  { id: 'friends', label: '道友' },
];

export function SocialPage() {
  const [tab, setTab] = useState<Tab>('chat');

  return (
    <div className="social">
      <header className="page-head">
        <h1 className="page-head__title">同道</h1>
        <p className="page-head__note">修行不必独行。</p>
      </header>
      <CloudRule />

      <div className="segments" role="tablist" aria-label="社交分页">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`segment ${tab === entry.id ? 'segment--on' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'chat' && <ChatPanel />}
      {tab === 'ranks' && <RankingsPanel />}
      {tab === 'friends' && (
        <div className="soon">
          <p className="empty" style={{ padding: 'var(--sp-5) 0' }}>
            尚无道友。加为好友后可见对方境界与在线，一同下秘境。
          </p>
          <span className="soon__flag">好友与组队 · 下一版开放</span>
        </div>
      )}
    </div>
  );
}
