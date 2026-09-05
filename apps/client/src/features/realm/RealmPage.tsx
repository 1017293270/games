import { useEffect, useState } from 'react';
import { stageName, type API, type ResponseOf } from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { ArtImage } from '../../art/ArtImage';
import { CloudRule } from '../../design';
import { useCharacterStore } from '../../store/character';
import '../social/social.css';

// `DungeonListResponse` has no exported type in the shared package yet, so the
// row type is derived from the endpoint itself.
type Dungeons = ResponseOf<typeof API.explore.dungeons>['dungeons'];

/**
 * 秘境论道 placeholder.
 *
 * The dungeons and the arena both need a party and a live opponent, which land
 * with the multiplayer milestone. Listing the real content now — with honest
 * unlock levels — is more use than an empty tab.
 */
export function RealmPage() {
  const view = useCharacterStore((state) => state.view);
  const [dungeons, setDungeons] = useState<Dungeons>([]);

  useEffect(() => {
    void api
      .dungeons()
      .then((response) => setDungeons(response.dungeons))
      .catch(() => setDungeons([]));
  }, []);

  const stage = view?.character.stageIndex ?? 0;

  return (
    <div>
      <header className="page-head">
        <h1 className="page-head__title">秘境论道</h1>
        <p className="page-head__note">洞天福地，独行难入。</p>
      </header>
      <CloudRule />

      <div className="soon">
        <p className="field__hint">
          四处秘境各镇一位妖王，气血是同阶妖兽的四倍——单人硬啃很难，结伴才是正解。
        </p>

        {dungeons.map((dungeon) => (
          <article className="soon__card" key={dungeon.id}>
            <div className="soon__art">
              <ArtImage id={dungeon.art} label={dungeon.name} motif="scene" small />
            </div>
            <div className="soon__body">
              <h2 className="soon__name">{dungeon.name}</h2>
              <p className="soon__note">{dungeon.description}</p>
              <p className="soon__note">
                镇守 {dungeon.boss.name} · 建议 {dungeon.partySize} 人 · 每日{' '}
                {dungeon.dailyLimit} 次
              </p>
              <span className="soon__flag">
                {stage < dungeon.unlockStage ? `需 ${stageName(dungeon.unlockStage)}` : '组队后开放'}
              </span>
            </div>
          </article>
        ))}

        {dungeons.length === 0 && <p className="empty">秘境入口尚未显形。</p>}

        <article className="soon__card">
          <div className="soon__art">
            <ArtImage id="npc/xianzi" label="青鸾仙子" motif="portrait" />
          </div>
          <div className="soon__body">
            <h2 className="soon__name">论道台</h2>
            <p className="soon__note">
              青鸾仙子主持论道。同境界附近匹配，胜负计入天梯，每日十次。
            </p>
            <span className="soon__flag">下一版开放</span>
          </div>
        </article>
      </div>
    </div>
  );
}
