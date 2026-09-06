import { useEffect, useState } from 'react';
import {
  formatDuration,
  MONSTER_BY_ID,
  zoneMap,
  ZONE_FLAGS,
  type Encounter,
  type ExploreBattleResponse,
} from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { Button, Overlay, Panel } from '../../design';
import { useCharacterStore } from '../../store/character';
import { toast } from '../../store/ui';
import { useZoneStore, zoneFrames } from '../../store/zone';
import { BattleReplay } from '../combat/BattleReplay';
import { EncounterDialog } from '../explore/EncounterDialog';
import './zone.css';

type BattleView = Extract<ExploreBattleResponse, { kind: 'battle' }>;

/** Ticks once a second so the BOSS clock and the respawn count move. */
function useSecond(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Everything laid over the field: who is here, when the BOSS is due, what the
 * stint has banked, and the three things a player can still do by hand while
 * the character fights on its own.
 */
export function ZoneHud() {
  const zoneId = useZoneStore((state) => state.zoneId);
  const roster = useZoneStore((state) => state.roster);
  const self = useZoneStore((state) => state.self);
  const boss = useZoneStore((state) => state.boss);
  const loot = useZoneStore((state) => state.loot);
  const death = useZoneStore((state) => state.death);
  const retreat = useZoneStore((state) => state.retreat);
  const view = useCharacterStore((state) => state.view);

  const [busy, setBusy] = useState(false);
  const [battle, setBattle] = useState<BattleView | null>(null);
  const [encounter, setEncounter] = useState<{ encounter: Encounter; token: string } | null>(null);
  const now = useSecond();

  const map = zoneId ? zoneMap(zoneId) : undefined;
  const rows = Object.values(roster);
  const cultivators = rows.filter((row) => row.kind === 'player' || row.kind === 'bot').length;
  const beasts = rows.length - cultivators;
  const selfFlags = self === null ? 0 : (zoneFrames.get(self)?.next.flags ?? 0);
  const protectedNow = Boolean(selfFlags & ZONE_FLAGS.PROTECTED);
  const respawnIn = death ? Math.max(0, Math.ceil((death.respawnAt - now) / 1000)) : 0;
  const bossIn = boss.nextAt === null ? 0 : Math.max(0, (boss.nextAt - now) / 1000);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setBusy(false);
    }
  };

  const gather = () =>
    act(async () => {
      if (!zoneId) return;
      const response = await api.gather(zoneId);
      useCharacterStore.getState().setView(response.view);
      const parts = [
        response.reward.exp > 0 ? `修为 +${response.reward.exp.toLocaleString('zh-CN')}` : '',
        response.reward.spiritStones > 0 ? `灵石 +${response.reward.spiritStones}` : '',
        ...response.reward.itemNames,
      ].filter(Boolean);
      toast(parts.length ? `采得 ${parts.join('，')}` : '空手而归', 'gain');
    });

  const track = () =>
    act(async () => {
      if (!zoneId) return;
      const response = await api.exploreBattle({ mapId: zoneId });
      useCharacterStore.getState().setView(response.view);
      if (response.kind === 'battle') setBattle(response);
      else setEncounter({ encounter: response.encounter, token: response.encounterToken });
    });

  return (
    <>
      <div className="zone-hud">
        <div className="zone-hud__bar">
          <span className="zone-hud__name">{map?.name ?? '战场'}</span>
          <span className="zone-hud__stat">
            在场 <b className="numeral">{cultivators}</b> 人 · 妖兽{' '}
            <b className="numeral">{beasts}</b>
          </span>
          <span className={`zone-hud__boss ${boss.alive ? 'zone-hud__boss--alive' : ''}`}>
            {boss.alive
              ? '秘境已现'
              : boss.nextAt === null
                ? '秘境未定'
                : `秘境 ${formatDuration(bossIn)}后`}
          </span>
          {protectedNow && <span className="zone-tag zone-tag--gold">护身</span>}
        </div>
      </div>

      <div className="zone-foot">
        <Panel className="zone-spoils" flush>
          <div className="zone-spoils__head">
            <span>本次战果</span>
            {loot && (
              <span className="muted">自 {formatDuration((now - loot.since) / 1000)}前</span>
            )}
          </div>
          <div className="zone-spoils__grid">
            <div className="zone-spoils__cell">
              <span className="zone-spoils__k">斩获</span>
              <span className="zone-spoils__v numeral">{loot?.kills ?? 0}</span>
            </div>
            <div className="zone-spoils__cell">
              <span className="zone-spoils__k">秘境</span>
              <span className="zone-spoils__v numeral">{loot?.bossKills ?? 0}</span>
            </div>
            <div className="zone-spoils__cell">
              <span className="zone-spoils__k">修为</span>
              <span className="zone-spoils__v numeral">
                {(loot?.exp ?? 0).toLocaleString('zh-CN')}
              </span>
            </div>
            <div className="zone-spoils__cell">
              <span className="zone-spoils__k">灵石</span>
              <span className="zone-spoils__v numeral">
                {(loot?.spiritStones ?? 0).toLocaleString('zh-CN')}
              </span>
            </div>
          </div>
          {loot && loot.items.length > 0 && (
            <div className="zone-spoils__drops">
              {loot.items.map((item) => (
                <span className="spoil spoil--gold" key={item.itemId}>
                  {item.name}
                  {item.qty > 1 ? ` ×${item.qty}` : ''}
                </span>
              ))}
            </div>
          )}
        </Panel>

        <div className="zone-acts">
          <Button size="sm" disabled={busy} onClick={() => void gather()}>
            采药
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void track()}>
            循迹
          </Button>
          <Button size="sm" variant="seal" onClick={retreat}>
            撤离
          </Button>
        </div>
      </div>

      {death && (
        <Overlay>
          <div className="scrim scrim--center zone-death" role="alertdialog" aria-label="身死道消">
            <div className="zone-death__card">
              <h2 className="ink-display">身死道消</h2>
              <p className="zone-death__by">败于 {death.killerName} 之手</p>
              {death.stonesLost > 0 && (
                <p className="zone-death__loss numeral">失灵石 {death.stonesLost}</p>
              )}
              <p className="zone-death__count numeral">{respawnIn}</p>
              <p className="muted">息止片刻，自会重回山门。</p>
            </div>
          </div>
        </Overlay>
      )}

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
              art: MONSTER_BY_ID.get(battle.monsterId)?.art ?? null,
              motif: 'beast',
              maxHp: MONSTER_BY_ID.get(battle.monsterId)?.stats.hp ?? 1,
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
              <p className="muted zone-lost">不敌而退，未失修为。养好气血再来。</p>
            )
          }
          onClose={() => setBattle(null)}
        />
      )}

      {encounter && (
        <EncounterDialog
          encounter={encounter.encounter}
          token={encounter.token}
          onClose={() => setEncounter(null)}
        />
      )}
    </>
  );
}
