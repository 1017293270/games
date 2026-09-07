import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  TREASURES,
  TREASURE_BY_ID,
  RELICS,
  RELIC_BY_ID,
  RELIC_SETS,
  PROGRESSION_GRADE_NAMES,
  TREASURE_FORM_NAMES,
  GACHA_RULES,
  DAILY_QUESTS,
  PROGRESSION_ACHIEVEMENTS,
  DAILY_REWARD,
  ACHIEVEMENT_REWARD,
  STARTER_REWARD,
  getProgression,
  progressionUpgradeCost,
  progressionBonuses,
  mainTreasureCombat,
  type GachaPool,
  type GachaDrawResult,
  type ProgressionState,
  type ProgressionUpgradeRequest,
  type TreasureDefinition,
  type RelicDefinition,
  type ProgressionMaterials,
} from '@xianxia/shared';
import { ProgressionArt } from './ProgressionArt';
import { Button, Sheet } from '../../design';
import { api } from '../../api/endpoints';
import { useCharacterStore } from '../../store/character';
import { useProgressionStore } from '../../store/progression';
import './progression.css';

const materialNames: Record<keyof ProgressionMaterials, string> = {
  jade: '仙玉',
  stardust: '星尘',
  starStones: '星辉石',
  breakthroughWood: '天罡木',
};
const rewardText = (reward: Partial<ProgressionMaterials>) =>
  Object.entries(reward)
    .filter(([, amount]) => amount)
    .map(([key, amount]) => `${materialNames[key as keyof ProgressionMaterials]} ${amount}`)
    .join(' · ');
const gradeColors = { mortal: '白', spirit: '蓝', immortal: '紫', saint: '金', divine: '红' };
const statNames: Record<string, string> = {
  hp: '气血',
  atk: '攻击',
  def: '防御',
  spd: '速度',
  crit: '暴击',
  critResist: '抗暴',
  acc: '命中',
  eva: '闪避',
};
const slotNames = ['本命', '辅助一', '辅助二'];

function Resources({ p }: { p: ProgressionState }) {
  return (
    <div className="pg-resources" aria-label="养成资源">
      {Object.entries(materialNames).map(([key, name]) => (
        <span key={key}>
          {name}
          <strong>{p.materials[key as keyof ProgressionMaterials].toLocaleString('zh-CN')}</strong>
        </span>
      ))}
    </div>
  );
}

function BonusText({ p }: { p: ProgressionState }) {
  const bonus = progressionBonuses(p);
  const parts = [
    ...Object.entries(bonus.extraPercent)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${statNames[k]} +${(v * 100).toFixed(1)}%`),
    ...Object.entries(bonus.extraFlat)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${statNames[k]} +${(v * 100).toFixed(1)}%`),
  ];
  if (bonus.cultivationBonus) parts.push(`修炼 +${(bonus.cultivationBonus * 100).toFixed(1)}%`);
  return <p>{parts.length ? parts.join(' · ') : '尚无收藏加成'}</p>;
}

function Card({
  def,
  children,
  missing,
  onClick,
}: {
  def: TreasureDefinition | RelicDefinition;
  children?: ReactNode;
  missing?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`pg-card ${missing ? 'pg-card--missing' : ''}`}
      data-grade={def.grade}
      onClick={onClick}
      aria-label={`${def.name}${missing ? ' 未拥有' : ''}`}
    >
      <span className="pg-art">
        <ProgressionArt definition={def} />
      </span>
      <strong>{def.name}</strong>
      <small>
        {PROGRESSION_GRADE_NAMES[def.grade]}阶 · {gradeColors[def.grade]}品
      </small>
      {children}
    </button>
  );
}

export function ProgressionPage({ page }: { page: 'treasures' | 'relics' | 'gacha' | 'daily' }) {
  const view = useCharacterStore((s) => s.view);
  const { busy, error, load, run } = useProgressionStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'owned'>('all');
  useEffect(() => {
    void load();
  }, [load, page]);
  if (!view) return null;
  const p = getProgression(view.character.progression, Date.now());
  const title = { treasures: '万宝归宗', relics: '古宝图鉴', gacha: '寻宝阁', daily: '仙途日课' }[
    page
  ];
  const kind = page === 'relics' ? 'relic' : 'treasure';
  const definitions = page === 'relics' ? RELICS : TREASURES;
  const ownedIds = new Set((page === 'relics' ? p.relics : p.treasures).map((v) => v.definitionId));
  return (
    <div className="progression">
      <header className="pg-header">
        <Link to="/">‹ 回洞府</Link>
        <h1>{title}</h1>
        <small>青云问道</small>
      </header>
      <Resources p={p} />
      {error && (
        <div className="pg-error" role="alert">
          {error}
        </div>
      )}
      {busy && (
        <p className="pg-muted" role="status">
          正在与仙府同步……
        </p>
      )}
      {page === 'gacha' ? (
        <Gacha p={p} />
      ) : page === 'daily' ? (
        <Daily p={p} />
      ) : (
        <>
          {page === 'treasures' ? (
            <>
              {!p.starterClaimed && (
                <section className="pg-panel">
                  <h2>仙门馈赠</h2>
                  <p className="pg-muted">
                    领取凡阶清音铃与守心盾，两件均可设为本命，清音铃默认出战。附赠{' '}
                    {rewardText(STARTER_REWARD)}。
                  </p>
                  <Button
                    variant="seal"
                    block
                    disabled={busy}
                    onClick={() =>
                      void run(() => api.progressionClaim({ kind: 'starter', id: 'starter' }))
                    }
                  >
                    领取入门法宝
                  </Button>
                </section>
              )}
              <div className="pg-slots">
                {slotNames.map((name, slot) => {
                  const item = p.treasures.find((t) => t.slot === slot);
                  const def = item && TREASURE_BY_ID.get(item.definitionId);
                  return (
                    <button
                      type="button"
                      className="pg-slot"
                      key={name}
                      onClick={() => {
                        if (def) setSelected(def.id);
                      }}
                      disabled={!def}
                    >
                      <small>{name}</small>
                      {def && (
                        <span className="pg-art">
                          <ProgressionArt definition={def} />
                        </span>
                      )}
                      <strong>{def?.name ?? '虚位以待'}</strong>
                      <small>{item ? `${item.level}级 · ${item.stars}星` : '从下方藏品装配'}</small>
                    </button>
                  );
                })}
              </div>
              <p className="pg-muted">
                本命独立释放威能，双辅加持属性。升级至百级，每十级突破；注灵十重，五星觉醒。
              </p>
            </>
          ) : (
            <section className="pg-panel">
              <h2>
                藏品共鸣 · {p.relics.length} / {RELICS.length}
              </h2>
              <p className="pg-muted">古宝无需装配，收藏即永久生效。</p>
              <BonusText p={{ ...p, treasures: [] }} />
            </section>
          )}
          <div className="pg-tabs" aria-label="图鉴筛选">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              全部图鉴 {definitions.length}
            </button>
            <button
              type="button"
              aria-pressed={filter === 'owned'}
              onClick={() => setFilter('owned')}
            >
              已拥有 {ownedIds.size}
            </button>
          </div>
          <div className="pg-grid">
            {definitions
              .filter((d) => filter === 'all' || ownedIds.has(d.id))
              .map((def) => {
                const owned = (page === 'relics' ? p.relics : p.treasures).find(
                  (v) => v.definitionId === def.id,
                );
                return (
                  <Card key={def.id} def={def} missing={!owned} onClick={() => setSelected(def.id)}>
                    <small>
                      {owned
                        ? `${owned.stars}星 · 注灵${owned.spiritLevel}重`
                        : def.grade === 'mortal'
                          ? '入门专属 · 未拥有'
                          : '未拥有 · 寻宝可得'}
                    </small>
                    {owned && (
                      <small>
                        碎片 {owned.fragments}
                        {'slot' in owned && typeof owned.slot === 'number'
                          ? ` · ${slotNames[owned.slot]}`
                          : ''}
                      </small>
                    )}
                  </Card>
                );
              })}
          </div>
          {filter === 'owned' && ownedIds.size === 0 && (
            <p className="pg-muted">
              尚无藏品。<Link to="/gacha">前往寻宝阁免费寻宝</Link>
            </p>
          )}
          {page === 'relics' && (
            <section className="pg-panel">
              <h2>三件收集套装</h2>
              {RELIC_SETS.map((set) => {
                const count = set.relicIds.filter((id) => ownedIds.has(id)).length;
                return (
                  <div className="pg-task" key={set.id}>
                    <div>
                      <strong>
                        {set.name} · {count}/3 {count === 3 ? '已激活' : '待集齐'}
                      </strong>
                      <p>{set.relicIds.map((id) => RELIC_BY_ID.get(id)?.name).join('、')}</p>
                      <p>{set.description}</p>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
          <TreasureDetail id={selected} kind={kind} p={p} onClose={() => setSelected(null)} />
        </>
      )}
    </div>
  );
}

function TreasureDetail({
  id,
  kind,
  p,
  onClose,
}: {
  id: string | null;
  kind: GachaPool;
  p: ProgressionState;
  onClose: () => void;
}) {
  const { busy, run, error } = useProgressionStore();
  const def = id ? (kind === 'treasure' ? TREASURE_BY_ID : RELIC_BY_ID).get(id) : undefined;
  const owned = (kind === 'treasure' ? p.treasures : p.relics).find((v) => v.definitionId === id);
  const treasure = p.treasures.find((v) => v.definitionId === id);
  const single = {
    ...p,
    treasures: treasure ? [{ ...treasure, slot: 0 as const }] : [],
    relics: kind === 'relic' && owned ? [owned] : [],
  };
  const combat = treasure && mainTreasureCombat(single);
  return (
    <Sheet open={!!def} title={def?.name} onClose={onClose}>
      <div className="pg-detail">
        {def && (
          <>
            <span className="pg-art">
              <ProgressionArt definition={def} />
            </span>
            <p>
              {PROGRESSION_GRADE_NAMES[def.grade]}阶 · {gradeColors[def.grade]}品{' '}
              {'form' in def ? `· ${TREASURE_FORM_NAMES[def.form]}形` : '· 收藏永久生效'}
            </p>
            <p>{def.description}</p>
          </>
        )}
        {error && (
          <p role="alert" className="pg-error">
            {error}
          </p>
        )}
        {owned ? (
          <>
            <p>
              {treasure ? `等级 ${treasure.level}/100 · ` : ''}注灵 {owned.spiritLevel}/10 · 星级{' '}
              {owned.stars}/5 {owned.stars === 5 ? '· 已觉醒' : ''}
            </p>
            <p>
              本体碎片 {owned.fragments} · 重复获得转为 {GACHA_RULES.duplicateFragments} 枚本体碎片
            </p>
            <BonusText p={single} />
            {combat && (
              <p>
                本命威能：每 {(combat.intervalMs / 1000).toFixed(1)} 秒施展，威力 ×
                {combat.power.toFixed(2)}。
              </p>
            )}
            {treasure && (
              <div className="pg-actions">
                {([0, 1, 2] as const).map((slot) => (
                  <Button
                    key={slot}
                    size="sm"
                    disabled={busy || treasure.slot === slot}
                    onClick={() =>
                      void run(() => api.progressionEquip({ uid: treasure.uid, slot }))
                    }
                  >
                    {treasure.slot === slot ? `已装${slotNames[slot]}` : `设为${slotNames[slot]}`}
                  </Button>
                ))}
                {treasure.slot !== null && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() => api.progressionEquip({ uid: treasure.uid, slot: null }))
                    }
                  >
                    卸下
                  </Button>
                )}
              </div>
            )}
            <div className="pg-actions">
              {(['level', 'infuse', 'star'] as const)
                .filter((action) => kind === 'treasure' || action !== 'level')
                .map((action) => {
                  const request: ProgressionUpgradeRequest = {
                    kind,
                    id: treasure?.uid ?? owned.definitionId,
                    action,
                  };
                  let cost: ReturnType<typeof progressionUpgradeCost> | null = null;
                  try {
                    cost = progressionUpgradeCost(p, request);
                  } catch {
                    /* Maximum progression has no next cost. */
                  }
                  const enough =
                    cost &&
                    Object.entries(cost).every(
                      ([key, amount]) =>
                        (key === 'fragments'
                          ? owned.fragments
                          : p.materials[key as keyof ProgressionMaterials]) >= amount,
                    );
                  const label =
                    action === 'level'
                      ? treasure && treasure.level % 10 === 0
                        ? '突破'
                        : '升级'
                      : action === 'infuse'
                        ? '注灵'
                        : owned.stars === 4
                          ? '升星觉醒'
                          : '升星';
                  const costLabel = cost
                    ? Object.entries(cost)
                        .map(
                          ([key, amount]) =>
                            `${key === 'fragments' ? '本体碎片' : materialNames[key as keyof ProgressionMaterials]} ${amount}`,
                        )
                        .join(' · ')
                    : '已满';
                  return (
                    <div key={action}>
                      <Button
                        block
                        disabled={busy || !enough}
                        onClick={() => void run(() => api.progressionUpgrade(request))}
                      >
                        {label}
                        {cost ? '' : '已满'}
                      </Button>
                      <p>
                        {costLabel}
                        {cost && !enough ? '（不足）' : ''}
                      </p>
                    </div>
                  );
                })}
            </div>
          </>
        ) : def?.grade === 'mortal' ? (
          <p>{'新版本首次领取入门馈赠可得清音铃与守心盾。'}凡阶法宝不在寻宝奖池中。</p>
        ) : (
          <p>
            尚未拥有，
            <Link to="/gacha" onClick={onClose}>
              前往寻宝阁
            </Link>{' '}
            收集此宝。
          </p>
        )}
      </div>
    </Sheet>
  );
}

function Gacha({ p }: { p: ProgressionState }) {
  const [pool, setPool] = useState<GachaPool>('treasure');
  const [results, setResults] = useState<GachaDrawResult[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [skip, setSkip] = useState(false);
  const { busy, draw, pendingDraw, retryDraw, loadHistory, history } = useProgressionStore();
  const free = !p.daily.freePools.includes(pool);
  const pull = async (count: 1 | 10, isFree = false) => {
    const result = await draw({ pool, count, free: isFree });
    if (result?.results) {
      setSkip(false);
      setResults(result.results);
    }
  };
  return (
    <>
      <div className="pg-tabs" aria-label="寻宝奖池">
        <button
          type="button"
          aria-pressed={pool === 'treasure'}
          onClick={() => setPool('treasure')}
        >
          法宝秘藏
        </button>
        <button type="button" aria-pressed={pool === 'relic'} onClick={() => setPool('relic')}>
          古宝遗珍
        </button>
      </div>
      <section className="pg-hero">
        <span className="pg-art">
          <ProgressionArt definition={pool === 'treasure' ? TREASURES[0]! : RELICS[0]!} />
        </span>
        <h2>{pool === 'treasure' ? '万宝归宗' : '千古遗珍'}</h2>
        <p>仙缘一念 · 探得天地奇珍</p>
      </section>
      <section className="pg-panel">
        <p>
          红品保底 {p.gacha[pool].pity} / {GACHA_RULES.hardPity} · 至多再{' '}
          {GACHA_RULES.hardPity - p.gacha[pool].pity} 抽必得红品
        </p>
        <p className="pg-muted">十连至少一件金品或红品 · 两池保底独立 · 每池每日免费一次</p>
        {pendingDraw && (
          <div className="pg-error" role="status">
            上次寻宝结果尚未确认，请重试该请求以取回结果。
            <Button
              disabled={busy}
              block
              onClick={() =>
                void retryDraw().then((result) => {
                  if (result?.results) setResults(result.results);
                })
              }
            >
              重试上次寻宝
            </Button>
          </div>
        )}
        <Button
          block
          variant="seal"
          disabled={busy || !free || !!pendingDraw}
          onClick={() => void pull(1, true)}
        >
          {free ? '每日免费寻宝' : '今日免费已用'}
        </Button>
        <div className="pg-actions">
          <Button
            disabled={busy || !!pendingDraw || p.materials.jade < GACHA_RULES.singleCost}
            onClick={() => void pull(1)}
          >
            寻宝一次 · {GACHA_RULES.singleCost}仙玉
          </Button>
          <Button
            disabled={busy || !!pendingDraw || p.materials.jade < GACHA_RULES.tenCost}
            onClick={() => void pull(10)}
          >
            寻宝十次 · {GACHA_RULES.tenCost}仙玉
          </Button>
        </div>
        {p.materials.jade < GACHA_RULES.singleCost && (
          <p className="pg-muted">
            仙玉不足，完成 <Link to="/daily">仙途日课</Link> 可领取仙玉。
          </p>
        )}
        <div className="pg-actions">
          <Button size="sm" onClick={() => setRulesOpen(true)}>
            概率与规则
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void loadHistory();
              setHistoryOpen(true);
            }}
          >
            寻宝记录
          </Button>
        </div>
      </section>
      <Sheet open={results.length > 0} title="仙缘已至" onClose={() => setResults([])}>
        <div className="pg-detail">
          <Button size="sm" onClick={() => setSkip(true)}>
            跳过揭示动画
          </Button>
          <div className={`pg-grid ${skip ? 'pg-reveal-skip' : ''}`}>
            {results.map((r, i) => {
              const def = (r.pool === 'treasure' ? TREASURE_BY_ID : RELIC_BY_ID).get(
                r.definitionId,
              );
              return (
                def && (
                  <div
                    className="pg-card pg-result"
                    data-grade={r.grade}
                    key={`${r.definitionId}-${i}`}
                    style={{ animationDelay: `${i * 70}ms` }}
                  >
                    <span className="pg-art">
                      <ProgressionArt definition={def} />
                    </span>
                    <strong>{def.name}</strong>
                    <small>
                      {gradeColors[r.grade]}品 · {r.duplicate ? `碎片 +${r.fragments}` : '新获'}
                    </small>
                  </div>
                )
              );
            })}
          </div>
          <p>藏品已收入仙府，重复藏品已转为本体碎片。</p>
          <Button block onClick={() => setResults([])}>
            收入囊中
          </Button>
        </div>
      </Sheet>
      <Sheet open={rulesOpen} title="寻宝规则公示" onClose={() => setRulesOpen(false)}>
        <div className="pg-detail">
          <p>
            本作概率：
            {GACHA_RULES.grades
              .map((g, i) => `${gradeColors[g]}品 ${GACHA_RULES.weights[i]}%`)
              .join('、')}
            。各品级内藏品等概率。以上为基础概率，保底会提高实际金／红品占比。
          </p>
          <p>
            单抽 {GACHA_RULES.singleCost} 仙玉，十连 {GACHA_RULES.tenCost}{' '}
            仙玉。每次十连至少金品；若前九抽均未出金或红，第十抽补至金品（已出红则保留）。累计未出红品至第{' '}
            {GACHA_RULES.hardPity} 抽必出红，出红后计数归零。
          </p>
          <p>
            法宝与古宝两池独立计数，免费抽同样计入保底。每日 UTC 00:00 重置免费次数。重复转为{' '}
            {GACHA_RULES.duplicateFragments} 枚对应本体碎片。凡阶入门法宝不进入奖池。
          </p>
          <p>这里没有真实付费入口；仙玉来自日课、成就与游戏奖励。</p>
        </div>
      </Sheet>
      <Sheet open={historyOpen} title="最近100笔寻宝" onClose={() => setHistoryOpen(false)}>
        <div className="pg-detail">
          {history.length === 0 ? (
            <p>暂无寻宝记录。</p>
          ) : (
            history.map((row) => (
              <div key={row.id}>
                <p>{new Date(row.at).toLocaleString('zh-CN')}</p>
                <p>
                  {row.results
                    .map(
                      (r) =>
                        `${(r.pool === 'treasure' ? TREASURE_BY_ID : RELIC_BY_ID).get(r.definitionId)?.name ?? r.definitionId}${r.duplicate ? `（碎片+${r.fragments}）` : ''}`,
                    )
                    .join('、')}
                </p>
              </div>
            ))
          )}
        </div>
      </Sheet>
    </>
  );
}

function Daily({ p }: { p: ProgressionState }) {
  const { busy, run } = useProgressionStore();
  const links = {
    kills: '/explore',
    cultivation: '/',
    dungeon: '/realm',
    arena: '/realm',
    chat: '/social',
  };
  return (
    <>
      <section className="pg-panel">
        <h2>今日修行</h2>
        <p className="pg-muted">每日 UTC 00:00 更新。每项奖励：{rewardText(DAILY_REWARD)}。</p>
        {DAILY_QUESTS.map((q) => {
          const claimed = p.daily.claimed.includes(q.id);
          const complete = p.daily[q.counter] >= q.target;
          return (
            <div className="pg-task" key={q.id}>
              <div>
                <strong>{q.name}</strong>
                <p>
                  {q.id === 'cultivation'
                    ? `${Math.min(60, Math.floor(p.daily.cultivationSeconds / 60))}/60 分钟`
                    : `${Math.min(q.target, p.daily[q.counter])}/${q.target}`}
                </p>
              </div>
              {complete ? (
                <Button
                  size="sm"
                  disabled={busy || claimed}
                  onClick={() => void run(() => api.progressionClaim({ kind: 'daily', id: q.id }))}
                >
                  {claimed ? '已领取' : '领取日课奖励'}
                </Button>
              ) : (
                <Link to={links[q.id]}>前往</Link>
              )}
            </div>
          );
        })}
      </section>
      <section className="pg-panel">
        <h2>仙途里程碑</h2>
        <p className="pg-muted">每项奖励：{rewardText(ACHIEVEMENT_REWARD)}。</p>
        {PROGRESSION_ACHIEVEMENTS.map((a) => {
          const claimed = p.claimedAchievements.includes(a.id);
          const complete = p.achievements.includes(a.id);
          return (
            <div className="pg-task" key={a.id}>
              <div>
                <strong>{a.name}</strong>
                <p>{a.id === 'first_breakthrough' ? '首次成功突破大境界' : '首次击败妖王 BOSS'}</p>
              </div>
              <Button
                size="sm"
                disabled={busy || !complete || claimed}
                onClick={() =>
                  void run(() => api.progressionClaim({ kind: 'achievement', id: a.id }))
                }
              >
                {claimed ? '已领取' : complete ? '领取成就奖励' : '未达成'}
              </Button>
            </div>
          );
        })}
      </section>
    </>
  );
}
