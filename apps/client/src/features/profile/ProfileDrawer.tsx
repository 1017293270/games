import { useEffect, useState } from 'react';
import {
  ITEM_BY_ID,
  RATE_STAT_KEYS,
  SKILL_BY_ID,
  spiritRootName,
  STAT_KEYS,
  STAT_NAMES,
  type PublicProfile,
} from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { ArtImage } from '../../art/ArtImage';
import { Button, Sheet } from '../../design';
import { useUiStore } from '../../store/ui';
import '../social/social.css';
import '../character/character.css';

const RATE_KEYS = new Set<string>(RATE_STAT_KEYS);

/**
 * Public dossier for any cultivator, bot or human. M1 shows it; the challenge
 * button arrives with 论道 in the PvP milestone.
 */
export function ProfileDrawer() {
  const profileId = useUiStore((state) => state.profileId);
  const close = useUiStore((state) => state.closeProfile);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) {
      setProfile(null);
      setError(null);
      return;
    }
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
  }, [profileId]);

  return (
    <Sheet open={Boolean(profileId)} title="修士名帖" onClose={close}>
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

          <Button variant="ghost" block disabled style={{ marginTop: 'var(--sp-4)' }}>
            论道切磋 · 下一版开放
          </Button>
        </>
      )}
    </Sheet>
  );
}
