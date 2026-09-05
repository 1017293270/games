import { useEffect, useState } from 'react';
import type { RaidAttackResponse } from '@xianxia/shared';
import { ArtImage } from '../../art/ArtImage';
import { Button, StoneMark } from '../../design';
import { useArenaStore } from '../../store/arena';
import { useCharacterStore } from '../../store/character';
import { usePartyStore } from '../../store/party';
import { useUiStore } from '../../store/ui';
import { BattleReplay } from '../combat/BattleReplay';
import { memberFighter, profileFighter, selfFighter } from '../combat/rosters';
import '../social/social.css';
import './raid.css';

/** `mm:ss` left on a protection window. */
function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** One shared clock so ten countdowns do not each hold their own timer. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** A pool everyone is draining: ink ground, cinnabar remaining, quartered. */
function BloodPool({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <span className="pool-line">
      <span
        className="pool"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        aria-label={label}
      >
        <span className="pool__fill" style={{ width: `${pct * 100}%` }} />
        <span className="pool__ticks" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
      </span>
      <span className="pool-line__pct">{Math.round(pct * 100)}%</span>
    </span>
  );
}

export function RaidBoard() {
  const view = useCharacterStore((state) => state.view);
  const party = usePartyStore((state) => state.party);
  const openProfile = useUiStore((state) => state.openProfile);

  const targets = useArenaStore((state) => state.targets);
  const targetsLoaded = useArenaStore((state) => state.targetsLoaded);
  const lastHitBotId = useArenaStore((state) => state.lastHitBotId);
  const busy = useArenaStore((state) => state.busy);
  const loadTargets = useArenaStore((state) => state.loadTargets);
  const attack = useArenaStore((state) => state.attack);

  const [raid, setRaid] = useState<RaidAttackResponse | null>(null);

  useEffect(() => {
    if (!targetsLoaded) void loadTargets();
  }, [targetsLoaded, loadTargets]);

  const protectedAny = targets.some((t) => t.protectedUntil > Date.now());
  const now = useTick(protectedAny);
  const partySize = party?.members.length ?? 0;
  const together = partySize >= 2;

  return (
    <div className="raid">
      <p className="raid__lede">
        血池由所有围攻者共用，打空才算破，赏金按出力分。
        {together ? ` 结伴 ${partySize} 人，一同上。` : ' 独自可上，但一人难空一池。'}
      </p>

      {targets.map((target) => {
        const safe = target.protectedUntil > now;
        const empty = target.hpPercent <= 0;
        return (
          <article
            className={[
              'raid-row',
              lastHitBotId === target.id ? 'raid-row--struck' : '',
              safe || empty ? 'raid-row--safe' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={target.id}
          >
            <button
              type="button"
              className="raid-row__art"
              aria-label={`查看 ${target.name}`}
              onClick={() => openProfile(target.id)}
            >
              <ArtImage id={target.avatarArt} label="" motif="portrait" />
            </button>

            <div className="raid-row__body">
              <div className="raid-row__head">
                <span className="raid-row__name">
                  {target.name}
                  {target.isBot && <span className="puppet">傀儡</span>}
                </span>
                <span className="raid-row__bounty">
                  <StoneMark />
                  {target.bounty.toLocaleString('zh-CN')}
                </span>
              </div>
              <span className="raid-row__sub numeral">
                {target.stageName} · 战力 {target.powerScore.toLocaleString('zh-CN')}
              </span>

              <BloodPool value={target.hpPercent} label={`${target.name} 血池`} />

              <div className="raid-row__foot">
                <span className={`raid-row__state ${safe ? 'raid-row__state--safe' : ''}`}>
                  {safe
                    ? `疗伤中 ${countdown(target.protectedUntil - now)}`
                    : empty
                      ? '血池已空，正在恢复'
                      : '可围攻'}
                </span>
                <Button
                  variant="seal"
                  size="sm"
                  disabled={busy || safe || empty}
                  onClick={() => {
                    void attack(target.id, together).then((result) => result && setRaid(result));
                  }}
                >
                  {together ? '合围' : '围攻'}
                </Button>
              </div>
            </div>
          </article>
        );
      })}

      {targets.length === 0 && (
        <p className="empty">{targetsLoaded ? '榜上暂无可攻之人。' : '正在张榜……'}</p>
      )}

      {raid && view && (
        <BattleReplay
          battle={raid.battle}
          title={`围攻 · ${raid.target.name}`}
          teamA={[
            selfFighter(view),
            ...(party?.members ?? [])
              .filter((m) => m.characterId !== view.character.id)
              .filter((m) => raid.participantIds.includes(m.characterId))
              .map((m) => memberFighter(m, [raid.battle])),
          ]}
          teamB={[
            profileFighter(
              raid.target,
              Math.max(1, raid.battle.finalHp[raid.target.id] ?? raid.target.stats.hp),
            ),
          ]}
          spoils={
            <div className="spoils">
              <span className="spoil">
                血池 {Math.round(raid.remainingHpPercent * 100)}%
                {raid.defeated ? ' · 已破' : ' 余'}
              </span>
              <span className="spoil">修为 +{raid.reward.exp.toLocaleString('zh-CN')}</span>
              <span className="spoil spoil--gold">
                灵石 +{raid.reward.spiritStones.toLocaleString('zh-CN')}
              </span>
            </div>
          }
          onClose={() => {
            setRaid(null);
            void loadTargets();
          }}
        />
      )}
    </div>
  );
}
