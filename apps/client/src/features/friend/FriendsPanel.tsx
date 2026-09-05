import { useEffect } from 'react';
import { isArtId, type Friend } from '@xianxia/shared';
import { ArtImage } from '../../art/ArtImage';
import { Button } from '../../design';
import { useFriendsStore } from '../../store/friends';
import { useUiStore } from '../../store/ui';
import '../social/social.css';
import './friend.css';

const GROUPS: { state: Friend['state']; label: string }[] = [
  { state: 'pending_in', label: '待你回音' },
  { state: 'accepted', label: '道友' },
  { state: 'pending_out', label: '已递名帖' },
];

/** 「三时前」 rather than a timestamp: this is a presence hint, not a log. */
function seenText(friend: Friend): string {
  if (friend.online) return '在线';
  const minutes = Math.max(0, (Date.now() - friend.lastSeenAt) / 60_000);
  if (minutes < 1) return '刚刚还在';
  if (minutes < 60) return `${Math.floor(minutes)} 分钟前在`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} 时前在`;
  return `${Math.floor(minutes / 1440)} 天前在`;
}

export function FriendsPanel() {
  const friends = useFriendsStore((state) => state.friends);
  const loaded = useFriendsStore((state) => state.loaded);
  const busyId = useFriendsStore((state) => state.busyId);
  const load = useFriendsStore((state) => state.load);
  const accept = useFriendsStore((state) => state.accept);
  const remove = useFriendsStore((state) => state.remove);
  const openProfile = useUiStore((state) => state.openProfile);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (loaded && friends.length === 0) {
    return (
      <div className="friends">
        <p className="empty">
          名册尚空。
          <span>在榜单或世界频道点开一位修士的名帖，递张帖子过去。</span>
        </p>
      </div>
    );
  }

  return (
    <div className="friends">
      {GROUPS.map((group) => {
        const rows = friends.filter((f) => f.state === group.state);
        if (rows.length === 0) return null;
        return (
          <section className="friends__group" key={group.state}>
            <h3 className="friends__heading">
              {group.label}
              <span className="friends__count">{rows.length}</span>
            </h3>

            {rows.map((friend) => (
              <div
                className={[
                  'friend-row',
                  friend.online ? '' : 'friend-row--off',
                  friend.state === 'pending_in' ? 'friend-row--pending' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={friend.characterId}
              >
                <button
                  type="button"
                  className="friend-row__art"
                  aria-label={`查看 ${friend.name}`}
                  onClick={() => openProfile(friend.characterId)}
                >
                  <ArtImage
                    id={isArtId(friend.avatarArt) ? friend.avatarArt : null}
                    label=""
                    motif="portrait"
                  />
                </button>

                <div className="friend-row__body">
                  <span className="friend-row__name">
                    {friend.online && <span className="online-dot" aria-label="在线" />}
                    {friend.name}
                  </span>
                  <span className="friend-row__sub numeral">
                    {friend.stageName} · 战力 {friend.powerScore.toLocaleString('zh-CN')} ·{' '}
                    {seenText(friend)}
                  </span>
                </div>

                <div className="friend-row__acts">
                  {friend.state === 'pending_in' && (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busyId === friend.characterId}
                      onClick={() => void accept(friend.characterId)}
                    >
                      结交
                    </Button>
                  )}
                  {friend.state === 'pending_out' && (
                    <span className="friend-row__wait">待回音</span>
                  )}
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busyId === friend.characterId}
                    onClick={() => void remove(friend.characterId)}
                  >
                    {friend.state === 'accepted' ? '断交' : friend.state === 'pending_in' ? '谢绝' : '收回'}
                  </Button>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
