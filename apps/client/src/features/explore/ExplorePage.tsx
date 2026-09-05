import { useCallback, useEffect, useState } from 'react';
import {
  formatDuration,
  stageName,
  type Encounter,
  type ExploreBattleResponse,
  type MapListEntry,
} from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { ArtImage } from '../../art/ArtImage';
import { CloudRule, Sheet } from '../../design';
import { useCharacterStore } from '../../store/character';
import { toast } from '../../store/ui';
import { BattleReplay } from '../combat/BattleReplay';
import { EncounterDialog } from './EncounterDialog';
import './explore.css';

type BattleView = Extract<ExploreBattleResponse, { kind: 'battle' }>;

export function ExplorePage() {
  const view = useCharacterStore((state) => state.view);
  const setView = useCharacterStore((state) => state.setView);
  const [maps, setMaps] = useState<MapListEntry[]>([]);
  const [open, setOpen] = useState<MapListEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [battle, setBattle] = useState<BattleView | null>(null);
  const [encounter, setEncounter] = useState<{ encounter: Encounter; token: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await api.exploreMaps();
      setMaps(response.maps);
      setOpen((current) =>
        current ? (response.maps.find((m) => m.id === current.id) ?? null) : null,
      );
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const fight = async (mapId: string, monsterId?: string) => {
    setBusy(true);
    try {
      const response = await api.exploreBattle(monsterId ? { mapId, monsterId } : { mapId });
      setView(response.view);
      setOpen(null);
      if (response.kind === 'battle') setBattle(response);
      else setEncounter({ encounter: response.encounter, token: response.encounterToken });
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setBusy(false);
    }
  };

  const gather = async (mapId: string) => {
    setBusy(true);
    try {
      const response = await api.gather(mapId);
      setView(response.view);
      const parts = [
        response.reward.exp > 0 ? `修为 +${response.reward.exp.toLocaleString('zh-CN')}` : '',
        response.reward.spiritStones > 0 ? `灵石 +${response.reward.spiritStones}` : '',
        ...response.reward.itemNames,
      ].filter(Boolean);
      toast(parts.length ? `采得 ${parts.join('，')}` : '空手而归', 'gain');
      await reload();
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  const monsterById = (id: string) => maps.flatMap((m) => m.monsters).find((m) => m.id === id);

  return (
    <div>
      <header className="page-head">
        <h1 className="page-head__title">山河图</h1>
        <p className="page-head__note">境界愈高，可去的地方愈远。</p>
      </header>
      <CloudRule />

      <div className="maps">
        {maps.map((map) => (
          <button
            key={map.id}
            type="button"
            className={`map-card ${map.unlocked ? '' : 'map-card--locked'}`}
            disabled={!map.unlocked}
            onClick={() => setOpen(map)}
          >
            <div className="map-card__art">
              <ArtImage id={map.art} label={map.name} motif="scene" small />
            </div>
            <div className="map-card__body">
              <h2 className="map-card__name">{map.name}</h2>
              <p className="map-card__desc">{map.description}</p>
              <div className="map-card__meta">
                {map.unlocked ? (
                  <>
                    <span>宜 {stageName(map.recommendedStage)}</span>
                    <span>{map.monsters.map((m) => m.name).join(' · ')}</span>
                    <span>
                      采药
                      {map.gatherReadyAt > now
                        ? ` ${formatDuration((map.gatherReadyAt - now) / 1000)}后`
                        : ' 可行'}
                    </span>
                  </>
                ) : (
                  <span className="map-card__lock">需 {stageName(map.unlockStage)}</span>
                )}
              </div>
            </div>
          </button>
        ))}
        {maps.length === 0 && <p className="empty">正在展开山河图……</p>}
      </div>

      <Sheet open={Boolean(open)} title={open?.name} onClose={() => setOpen(null)}>
        {open && (
          <div className="actions">
            {open.monsters.map((monster) => (
              <button
                key={monster.id}
                type="button"
                className="action-row"
                disabled={busy}
                onClick={() => void fight(open.id, monster.id)}
              >
                <span className="action-row__art">
                  <ArtImage id={monster.art} label="" motif="beast" />
                </span>
                <span className="action-row__body">
                  <span className="action-row__name">讨伐 · {monster.name}</span>
                  <span className="action-row__note">
                    {stageName(monster.stageIndex)} · 修为{' '}
                    {monster.expReward.toLocaleString('zh-CN')} · 灵石 {monster.stoneReward}
                  </span>
                </span>
              </button>
            ))}

            <button
              type="button"
              className="action-row"
              disabled={busy || open.gatherReadyAt > now}
              onClick={() => void gather(open.id)}
            >
              <span className="action-row__glyph" aria-hidden="true">
                药
              </span>
              <span className="action-row__body">
                <span className="action-row__name">采药</span>
                <span className="action-row__note">
                  {open.gatherReadyAt > now
                    ? `灵草未长成，${formatDuration((open.gatherReadyAt - now) / 1000)}后再来`
                    : '五分钟一采，所得随地而异'}
                </span>
              </span>
            </button>

            <button
              type="button"
              className="action-row"
              disabled={busy}
              onClick={() => void fight(open.id)}
            >
              <span className="action-row__glyph" aria-hidden="true">
                寻
              </span>
              <span className="action-row__body">
                <span className="action-row__name">循迹而行</span>
                <span className="action-row__note">
                  或撞上妖兽，或遇一场机缘（约 {Math.round(open.encounterChance * 100)}% 奇遇）
                </span>
              </span>
            </button>
          </div>
        )}
      </Sheet>

      {battle && view && (
        <BattleReplay
          battle={battle.battle}
          title={battle.monsterName}
          teamA={[
            {
              id: view.character.id,
              name: view.character.name,
              art: view.character.avatarArt,
              motif: 'portrait',
              maxHp: view.stats.hp,
            },
          ]}
          teamB={[
            {
              id: battle.monsterId,
              name: battle.monsterName,
              art: monsterById(battle.monsterId)?.art ?? null,
              motif: 'beast',
              maxHp: monsterById(battle.monsterId)?.stats.hp ?? 1,
            },
          ]}
          spoils={
            battle.won ? (
              <div className="spoils">
                <span className="spoil">修为 +{battle.reward.exp.toLocaleString('zh-CN')}</span>
                <span className="spoil">灵石 +{battle.reward.spiritStones}</span>
                {battle.reward.itemNames.map((name) => (
                  <span className="spoil spoil--gold" key={name}>
                    {name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ textAlign: 'center', fontSize: 'var(--fs-sm)' }}>
                不敌而退，未失修为。养好气血再来。
              </p>
            )
          }
          onClose={() => {
            setBattle(null);
            void reload();
          }}
        />
      )}

      {encounter && (
        <EncounterDialog
          encounter={encounter.encounter}
          token={encounter.token}
          onClose={() => {
            setEncounter(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
