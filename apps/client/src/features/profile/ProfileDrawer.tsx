import { useEffect, useState } from 'react';
import {
  ITEM_BY_ID,
  RATE_STAT_KEYS,
  SKILL_BY_ID,
  spiritRootName,
  STAT_KEYS,
  STAT_NAMES,
  type ArenaChallengeResponse,
  type PublicProfile,
} from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { ArtImage } from '../../art/ArtImage';
import { Button, Sheet } from '../../design';
import { useArenaStore } from '../../store/arena';
import { useCharacterStore } from '../../store/character';
import { useFriendsStore } from '../../store/friends';
import { usePartyStore } from '../../store/party';
import { toast, useUiStore } from '../../store/ui';
import { BattleReplay } from '../combat/BattleReplay';
import { profileFighter, selfFighter } from '../combat/rosters';
import { copyText } from '../party/clipboard';
import '../social/social.css';
import '../character/character.css';
import './profile.css';

const RATE_KEYS = new Set<string>(RATE_STAT_KEYS);

const FRIEND_STATE_TEXT: Record<string, string> = {
  accepted: '已是道友',
  pending_out: '名帖已递，静候回音',
  pending_in: '对方已递名帖，去「同道 › 道友」回一句',
};

/**
 * Public dossier for any cultivator, bot or human — and the three things you
 * can do about one: spar, ask to be friends, or hand over an invite code.
 */
export function ProfileDrawer() {
  const profileId = useUiStore((state) => state.profileId);
  const close = useUiStore((state) => state.closeProfile);
  const view = useCharacterStore((state) => state.view);

  const challenge = useArenaStore((state) => state.challenge);
  const arenaBusy = useArenaStore((state) => state.busy);
  const friends = useFriendsStore((state) => state.friends);
  const friendsLoaded = useFriendsStore((state) => state.loaded);
  const loadFriends = useFriendsStore((state) => state.load);
  const requestFriend = useFriendsStore((state) => state.request);
  const friendBusyId = useFriendsStore((state) => state.busyId);
  const party = usePartyStore((state) => state.party);
  const createParty = usePartyStore((state) => state.create);
  const partyBusy = usePartyStore((state) => state.busy);

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bout, setBout] = useState<ArenaChallengeResponse | null>(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (!profileId) {
      setProfile(null);
      setError(null);
      setBout(null);
      setInviting(false);
      return;
    }
    if (!friendsLoaded) void loadFriends();
    let alive = true;
    void api
      .publicProfile(profileId)
      .then((result) => {
        if (alive) setProfile(result);
      })
      .catch((cause: unknown) => {
        if (alive) setError(errorMessage(cause));
      });
    return () => {
      alive = false;
    };
  }, [profileId, friendsLoaded, loadFriends]);

  const isSelf = Boolean(profile && view && profile.id === view.character.id);
  const friendState = friends.find((f) => f.characterId === profile?.id)?.state ?? null;
  const inviteCode = party?.code ?? null;

  return (
    <>
      <Sheet open={Boolean(profileId) && !bout} title="修士名帖" onClose={close}>
        {error && <p className="empty">{error}</p>}
        {!profile && !error && <p className="empty">正在查阅……</p>}
        {profile && (
          <>
            <div className="profile__head">
              <div className="profile__art">
                <ArtImage id={profile.avatarArt} label="" motif="portrait" />
              </div>
              <div className="profile__meta">
                <h3 className="profile__name">
                  {profile.name}
                  {profile.isBot && <span className="puppet">傀儡</span>}
                </h3>
                <p className="profile__sub">
                  {profile.stageName} · {spiritRootName(profile.spiritRoot)}
                </p>
                <p className="profile__sub numeral">
                  战力 {profile.powerScore.toLocaleString('zh-CN')} · 论道 {profile.arenaRating}（
                  {profile.arenaWins}胜{profile.arenaLosses}负）
                </p>
              </div>
            </div>

            <div className="profile__tags">
              {profile.techniqueName && <span className="tag">功法 {profile.techniqueName}</span>}
              {profile.skillIds.map((id) => (
                <span className="tag" key={id}>
                  {SKILL_BY_ID.get(id)?.name ?? id}
                </span>
              ))}
              {profile.equipmentItemIds.map((id) => (
                <span className="tag" key={id}>
                  {ITEM_BY_ID.get(id)?.name ?? id}
                </span>
              ))}
            </div>

            <div className="stats-grid">
              {STAT_KEYS.map((key) => (
                <div className="stat" key={key}>
                  <span className="stat__k">{STAT_NAMES[key]}</span>
                  <span className="stat__v numeral">
                    {RATE_KEYS.has(key)
                      ? `${(profile.stats[key] * 100).toFixed(1)}%`
                      : Math.round(profile.stats[key]).toLocaleString('zh-CN')}
                  </span>
                </div>
              ))}
            </div>

            {isSelf ? (
              <p className="dossier-state">这是你自己的名帖。</p>
            ) : (
              <>
                <div className="dossier-acts">
                  <Button
                    variant="seal"
                    disabled={arenaBusy}
                    onClick={() => {
                      void challenge(profile.id).then((result) => result && setBout(result));
                    }}
                  >
                    论道
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={Boolean(friendState) || friendBusyId === profile.id}
                    onClick={() => void requestFriend(profile.id)}
                  >
                    {friendState === 'accepted' ? '已结交' : '加为道友'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={partyBusy}
                    onClick={() => {
                      setInviting(true);
                      if (!party) void createParty();
                    }}
                  >
                    邀请入队
                  </Button>
                </div>

                {friendState && (
                  <p className="dossier-state">{FRIEND_STATE_TEXT[friendState]}</p>
                )}

                {inviting &&
                  (inviteCode ? (
                    <div className="invite-strip">
                      <strong className="invite-strip__code">{inviteCode}</strong>
                      <span className="invite-strip__note">
                        把这六位码报给 {profile.name}，对方在「同道 › 组队」输入即可入队。
                      </span>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => {
                          void copyText(inviteCode).then((ok) =>
                            toast(ok ? `已抄下 ${inviteCode}` : `手抄一下：${inviteCode}`,
                              ok ? 'gain' : 'info'),
                          );
                        }}
                      >
                        抄走
                      </Button>
                    </div>
                  ) : (
                    <p className="dossier-state">正在立队，稍候便有邀请码……</p>
                  ))}
              </>
            )}
          </>
        )}
      </Sheet>

      {bout && view && (
        <BattleReplay
          battle={bout.battle}
          title={`论道 · ${bout.opponent.name}`}
          teamA={[selfFighter(view)]}
          teamB={[profileFighter(bout.opponent)]}
          spoils={
            <div className="spoils">
              <span className="spoil">
                天梯 {bout.ratingBefore} → {bout.ratingAfter}
              </span>
              {bout.reward.exp > 0 && (
                <span className="spoil">修为 +{bout.reward.exp.toLocaleString('zh-CN')}</span>
              )}
              <span className="spoil">灵石 +{bout.reward.spiritStones.toLocaleString('zh-CN')}</span>
            </div>
          }
          onClose={() => setBout(null)}
        />
      )}
    </>
  );
}
