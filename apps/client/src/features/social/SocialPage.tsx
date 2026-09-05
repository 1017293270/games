import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { CloudRule } from '../../design';
import { useFriendsStore } from '../../store/friends';
import { usePartyStore } from '../../store/party';
import { ChatPanel } from '../chat/ChatPanel';
import { FriendsPanel } from '../friend/FriendsPanel';
import { PartyPanel } from '../party/PartyPanel';
import { RankingsPanel } from '../rankings/RankingsPanel';
import './social.css';

type Tab = 'chat' | 'ranks' | 'party' | 'friends';

const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: '世界' },
  { id: 'ranks', label: '榜单' },
  { id: 'party', label: '组队' },
  { id: 'friends', label: '道友' },
];

export function SocialPage() {
  // 秘境论道 sends people here to build a party; the tab it wants rides along in
  // the navigation state so no extra route is needed.
  const wanted = (useLocation().state as { tab?: Tab } | null)?.tab;
  const [tab, setTab] = useState<Tab>(wanted ?? 'chat');
  const partySize = usePartyStore((state) => state.party?.members.length ?? 0);
  const friends = useFriendsStore((state) => state.friends);
  const loadFriends = useFriendsStore((state) => state.load);
  const friendsLoaded = useFriendsStore((state) => state.loaded);

  // The 道友 tab wears a mark when someone is waiting on an answer, so the
  // request is visible without opening the tab.
  useEffect(() => {
    if (!friendsLoaded) void loadFriends();
  }, [friendsLoaded, loadFriends]);

  const waiting = friends.filter((f) => f.state === 'pending_in').length;

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
            {entry.id === 'party' && partySize > 0 && (
              <span className="segment__n numeral">{partySize}</span>
            )}
            {entry.id === 'friends' && waiting > 0 && (
              <span className="segment__dot" aria-label={`${waiting} 份申请待回`} />
            )}
          </button>
        ))}
      </div>

      {tab === 'chat' && <ChatPanel />}
      {tab === 'ranks' && <RankingsPanel />}
      {tab === 'party' && <PartyPanel />}
      {tab === 'friends' && <FriendsPanel />}
    </div>
  );
}
