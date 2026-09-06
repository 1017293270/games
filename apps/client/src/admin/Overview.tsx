import { useEffect, useState } from 'react';
import {
  REALM_NAMES,
  SUB_STAGE_NAMES,
  SUB_STAGES_PER_REALM,
  type AdminStats,
  type BotArchetype,
  type WorldSettings,
} from '@xianxia/shared';
import { errorMessage } from '../api/http';
import { adminApi } from './api';
import { duration, Notice, Section, stamp, Stat, useTicker } from './ui';

/** How often the dashboard re-reads the server. */
const POLL_MS = 2000;

interface Snapshot {
  stats: AdminStats;
  settings: WorldSettings;
  archetypes: BotArchetype[];
}

/**
 * 概览.
 *
 * The hero is 息 — the bot loop's breath. A world that keeps cultivating while
 * nobody is watching has exactly one thing an operator needs to see at a
 * glance: that the loop is alive and how fast it is running. Shortening
 * `botTickSeconds` visibly shortens this bar's period, which is also how the
 * hot-reload of that setting is verified.
 */
export function Overview() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useTicker(500);

  useEffect(() => {
    let alive = true;
    const pull = async (): Promise<void> => {
      try {
        const [stats, settings, archetypes] = await Promise.all([
          adminApi.stats(),
          adminApi.settings(),
          adminApi.archetypes(),
        ]);
        if (!alive) return;
        setSnapshot({ stats, settings, archetypes: archetypes.archetypes });
        setError(null);
      } catch (cause) {
        if (alive) setError(errorMessage(cause));
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (error && !snapshot) return <Notice tone="warn">{error}</Notice>;
  if (!snapshot) return <p className="adm-loading">正在起卦……</p>;

  const { stats, settings, archetypes } = snapshot;
  const period = settings.botTickSeconds;
  // The dashboard's clock is the operator's; `serverTime` says how far apart
  // the two are, so an age computed locally is corrected by that skew.
  const skew = stats.server.serverTime - Date.now();
  const sinceTick =
    stats.server.lastBotTickAt === null
      ? null
      : Math.max(0, (now + skew - stats.server.lastBotTickAt) / 1000);
  const breath = sinceTick === null ? 0 : Math.min(1, sinceTick / Math.max(1, period));

  const realmTotal = stats.bots.byRealm.reduce((a, b) => a + b, 0);
  const realmPeak = Math.max(1, ...stats.bots.byRealm);
  const perfectionShare = realmTotal === 0 ? 0 : stats.bots.atPerfection / realmTotal;
  const archetypeName = (id: string): string =>
    archetypes.find((a) => a.id === id)?.name ?? (id === '' ? '无原型' : id);
  const lastTick = stats.server.lastTick;

  return (
    <>
      <Section title="息" lede="机器人世界的呼吸。每一息，全服机器人结算一次修为、突破、论道与闲谈。">
        <div className="adm-breath">
          <div
            className="adm-breath__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(breath * 100)}
            aria-label="距下一息"
          >
            <span className="adm-breath__fill" style={{ width: `${breath * 100}%` }} />
          </div>
          <p className="adm-breath__read numeral">
            {sinceTick === null ? (
              <span className="adm-breath__idle">尚未起息 —— 机器人循环未启动</span>
            ) : (
              <>
                上一息 <strong>{duration(sinceTick)}</strong> 前 · 每 <strong>{period}</strong> 秒一息
              </>
            )}
          </p>
        </div>

        {lastTick ? (
          <dl className="adm-tick">
            <div>
              <dt>耗时</dt>
              <dd className="numeral">{lastTick.durationMs} ms</dd>
            </div>
            <div>
              <dt>活跃人数</dt>
              <dd className="numeral">{lastTick.bots}</dd>
            </div>
            <div>
              <dt>新建</dt>
              <dd className="numeral">{lastTick.created}</dd>
            </div>
            <div>
              <dt>突破</dt>
              <dd className="numeral">{lastTick.breakthroughs}</dd>
            </div>
            <div>
              <dt>渡劫</dt>
              <dd className="numeral">{lastTick.tribulations}</dd>
            </div>
            <div>
              <dt>论道</dt>
              <dd className="numeral">{lastTick.battles}</dd>
            </div>
            <div>
              <dt>闲谈</dt>
              <dd className="numeral">{lastTick.chats}</dd>
            </div>
          </dl>
        ) : null}
      </Section>

      <Section title="世相" lede="今日截至此刻的全服数字。">
        <div className="adm-stats">
          <Stat label="在线" value={stats.players.online} note={`共 ${stats.players.total} 个账号`} />
          <Stat label="机器人" value={stats.bots.total} note={`目标 ${settings.botCount}`} />
          <Stat label="今日新入" value={stats.players.newToday} note="注册账号" />
          <Stat label="封禁" value={stats.players.banned} note="账号" />
          <Stat label="今日突破" value={stats.activity.breakthroughsToday} />
          <Stat label="今日战斗" value={stats.activity.battlesToday} />
          <Stat label="今日论道" value={stats.activity.arenaMatchesToday} />
          <Stat label="今日秘境" value={stats.activity.dungeonRunsToday} />
        </div>
      </Section>

      <Section
        title="境界分布"
        lede={
          `${realmTotal} 名机器人修士按大境界分布，低境拥挤、高境稀疏才是活着的世界。` +
          `每根柱子自下而上分 ${SUB_STAGE_NAMES.join(' / ')} 四段。`
        }
        actions={
          <span className="adm-realms__perfection numeral">
            卡在圆满 <strong>{stats.bots.atPerfection}</strong> 人 ·{' '}
            {Math.round(perfectionShare * 100)}%
          </span>
        }
      >
        <div className="adm-realms">
          {stats.bots.byRealm.map((count, index) => {
            const subs = subStagesOf(stats.bots.byStage, index);
            const perfection = subs[SUB_STAGES_PER_REALM - 1] ?? 0;
            return (
              <div className="adm-realm" key={REALM_NAMES[index]}>
                <span className="adm-realm__count numeral">{count}</span>
                <span
                  className="adm-realm__column"
                  title={subs
                    .map((n, sub) => `${SUB_STAGE_NAMES[sub]} ${n}`)
                    .join(' · ')}
                >
                  <span
                    className="adm-realm__fill"
                    style={{ height: `${(count / realmPeak) * 100}%` }}
                    aria-hidden="true"
                  >
                    {subs.map((n, sub) => (
                      <span
                        key={SUB_STAGE_NAMES[sub]}
                        className={`adm-realm__seg adm-realm__seg--${sub}`}
                        style={{ flexGrow: n }}
                      />
                    ))}
                  </span>
                </span>
                <span className="adm-realm__perfection numeral">
                  {count === 0 ? '—' : `圆满 ${Math.round((perfection / count) * 100)}%`}
                </span>
                <span className="adm-realm__name">{REALM_NAMES[index]}</span>
              </div>
            );
          })}
        </div>
        <ul className="adm-legend">
          {SUB_STAGE_NAMES.map((name, sub) => (
            <li className="adm-legend__item" key={name}>
              <span className={`adm-legend__swatch adm-realm__seg--${sub}`} aria-hidden="true" />
              {name}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="原型分布" lede="批量生成按原型权重抽签，改权重只影响此后新生成的机器人。">
        <ul className="adm-bars">
          {Object.entries(stats.bots.byArchetype)
            .sort((a, b) => b[1] - a[1])
            .map(([id, count]) => (
              <li className="adm-bar" key={id || 'none'}>
                <span className="adm-bar__name">{archetypeName(id)}</span>
                <span className="adm-bar__track" aria-hidden="true">
                  <span
                    className="adm-bar__fill"
                    style={{ width: `${(count / Math.max(1, stats.bots.total)) * 100}%` }}
                  />
                </span>
                <span className="adm-bar__value numeral">{count}</span>
              </li>
            ))}
          {Object.keys(stats.bots.byArchetype).length === 0 ? (
            <li className="adm-empty">还没有机器人。到「机器人」页批量生成一批。</li>
          ) : null}
        </ul>
      </Section>

      <Section title="服务器">
        <dl className="adm-kv">
          <div>
            <dt>版本</dt>
            <dd className="numeral">{stats.server.version}</dd>
          </div>
          <div>
            <dt>启动于</dt>
            <dd className="numeral">{stamp(stats.server.startedAt)}</dd>
          </div>
          <div>
            <dt>已运行</dt>
            <dd className="numeral">{duration(stats.server.uptimeSec)}</dd>
          </div>
          <div>
            <dt>服务器时间</dt>
            <dd className="numeral">{stamp(stats.server.serverTime)}</dd>
          </div>
          <div>
            <dt>上一息</dt>
            <dd className="numeral">{stamp(stats.server.lastBotTickAt)}</dd>
          </div>
          <div>
            <dt>今日闲谈</dt>
            <dd className="numeral">{stats.activity.chatMessagesToday}</dd>
          </div>
        </dl>
        {error ? <Notice tone="warn">{error}</Notice> : null}
      </Section>
    </>
  );
}

/** The four 小境界 counts inside one 大境界, 前期 first. */
function subStagesOf(byStage: readonly number[], realm: number): number[] {
  const start = realm * SUB_STAGES_PER_REALM;
  return Array.from(
    { length: SUB_STAGES_PER_REALM },
    (_, sub) => byStage[start + sub] ?? 0,
  );
}
