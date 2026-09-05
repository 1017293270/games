import { useCallback, useEffect, useState } from 'react';
import { stageName, type DungeonListEntry, type DungeonStartResponse } from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { ArtImage } from '../../art/ArtImage';
import { Button } from '../../design';
import { useCharacterStore } from '../../store/character';
import { usePartyStore } from '../../store/party';
import { toast } from '../../store/ui';
import { DungeonRunReplay } from './DungeonRunReplay';
import './dungeon.css';

export function DungeonLobby({ onWantParty }: { onWantParty: () => void }) {
  const setView = useCharacterStore((state) => state.setView);
  const party = usePartyStore((state) => state.party);
  const loadParty = usePartyStore((state) => state.load);
  const markSelfRun = usePartyStore((state) => state.markSelfRun);
  const [dungeons, setDungeons] = useState<DungeonListEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [run, setRun] = useState<DungeonStartResponse | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await api.dungeons();
      setDungeons(response.dungeons);
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    void loadParty();
  }, [reload, loadParty]);

  const start = async (dungeon: DungeonListEntry, withParty: boolean) => {
    setBusyId(dungeon.id);
    // The server echoes the run back over `dungeon:result` too; flag it so the
    // party store drops the copy that would replay this a second time.
    if (withParty) markSelfRun();
    try {
      const response = await api.startDungeon({ dungeonId: dungeon.id, withParty });
      setView(response.view);
      setRun(response);
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setBusyId(null);
    }
  };

  const partySize = party?.members.length ?? 0;

  return (
    <div className="dungeons">
      <p className="dungeon-lede">
        每处秘境两阵杂兵，末阵一位妖王，气血是同阶妖兽的四倍。
        气血在阵与阵之间不回复——独闯走得完，也走得险。
      </p>

      {dungeons.map((dungeon) => {
        const limit = Math.max(1, dungeon.dailyLimit);
        const left = Math.max(0, limit - dungeon.runsToday);
        const spent = left === 0;
        return (
          <article
            className={`dungeon-card ${dungeon.unlocked ? '' : 'dungeon-card--locked'}`}
            key={dungeon.id}
          >
            <div className="dungeon-card__top">
              <div className="dungeon-card__art">
                <ArtImage id={dungeon.boss.art} label="" motif="beast" small />
                <span className="dungeon-card__boss">{dungeon.boss.name}</span>
              </div>
              <div className="dungeon-card__body">
                <h3 className="dungeon-card__name">{dungeon.name}</h3>
                <p className="dungeon-card__desc">{dungeon.description}</p>
                <div className="dungeon-card__meta">
                  {dungeon.unlocked ? (
                    <>
                      <span>建议 {dungeon.partySize} 人</span>
                      <span>宜 {stageName(dungeon.recommendedStage)}</span>
                      <span className="runs">
                        今日
                        {Array.from({ length: limit }, (_, i) => (
                          <span
                            className={`runs__pip ${i < dungeon.runsToday ? 'runs__pip--used' : ''}`}
                            key={i}
                          />
                        ))}
                        <span className="numeral">
                          {dungeon.runsToday}/{limit}
                        </span>
                      </span>
                    </>
                  ) : (
                    <span className="dungeon-card__lock">需 {stageName(dungeon.unlockStage)}</span>
                  )}
                </div>
              </div>
            </div>

            {dungeon.unlocked && (
              <>
                <div className="dungeon-card__acts">
                  <Button
                    variant="ghost"
                    disabled={busyId !== null || spent}
                    onClick={() => void start(dungeon, false)}
                  >
                    {busyId === dungeon.id ? '入境中……' : '独闯'}
                  </Button>
                  <Button
                    variant="seal"
                    disabled={busyId !== null || spent || partySize < 2}
                    onClick={() => void start(dungeon, true)}
                  >
                    结伴{partySize >= 2 ? ` ${partySize} 人` : ''}
                  </Button>
                </div>
                {spent ? (
                  <p className="dungeon-card__hint">今日次数已尽，明日再来。</p>
                ) : partySize < 2 ? (
                  <p className="dungeon-card__hint">
                    尚无同行之人。
                    <button type="button" onClick={onWantParty}>
                      去结一支队伍
                    </button>
                  </p>
                ) : null}
              </>
            )}
          </article>
        );
      })}

      {loaded && dungeons.length === 0 && <p className="empty">秘境入口尚未显形。</p>}

      {run && (
        <DungeonRunReplay
          dungeonId={run.dungeonId}
          battles={run.battles}
          cleared={run.cleared}
          reward={run.reward}
          participantIds={run.participantIds}
          onClose={() => {
            setRun(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
