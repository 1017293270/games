import { useState } from 'react';
import {
  getStage,
  MAX_STAGE_INDEX,
  spiritRootName,
  stageName,
  type BotParams,
  type BotSummary,
} from '@xianxia/shared';
import { errorMessage } from '../api/http';
import { adminApi } from './api';
import {
  NumField,
  Notice,
  Pager,
  Section,
  SelectField,
  stamp,
  TableScroll,
  TextField,
  useAsync,
} from './ui';

/**
 * 机器人.
 *
 * One bot is one row; opening a row turns it into its own parameter bench, so
 * a retune is always made next to the neighbours it will be compared against.
 * Nothing here is modal: comparing 天骄 against 苦修 is the whole job.
 */

const PREF_LABELS: Record<BotParams['explorePref'], string> = {
  cultivate: '专修',
  explore: '探索',
  dungeon: '秘境',
  arena: '论道',
};

const SORT_LABELS: Record<'stage' | 'power' | 'name' | 'rating', string> = {
  stage: '境界',
  power: '战力',
  name: '道号',
  rating: '论道分',
};

const PAGE_SIZE = 20;

export function Bots() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [archetypeId, setArchetypeId] = useState('');
  const [sort, setSort] = useState<'stage' | 'power' | 'name' | 'rating'>('stage');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [openId, setOpenId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const archetypes = useAsync(() => adminApi.archetypes(), 'archetypes');
  const key = `${page}|${q}|${archetypeId}|${sort}|${order}`;
  const bots = useAsync(
    () =>
      adminApi.bots({
        page,
        pageSize: PAGE_SIZE,
        sort,
        order,
        ...(q ? { q } : {}),
        ...(archetypeId ? { archetypeId } : {}),
      }),
    key,
  );

  const archetypeOptions = [
    { value: '', label: '全部原型' },
    ...(archetypes.data?.archetypes ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const refresh = (): void => {
    bots.reload();
    setOpenId(null);
  };

  return (
    <>
      <Generate
        options={(archetypes.data?.archetypes ?? []).map((a) => ({ value: a.id, label: a.name }))}
        onDone={(created) => {
          setFlash(`已生成 ${created} 名机器人修士。`);
          setPage(1);
          refresh();
        }}
      />

      <Section
        title="名册"
        lede="点开一行即可就地调参。改动在下一息生效。"
        actions={
          <button type="button" className="adm-btn adm-btn--quiet" onClick={refresh}>
            重读
          </button>
        }
      >
        {flash ? <Notice tone="done">{flash}</Notice> : null}
        {bots.error ? <Notice tone="warn">{bots.error}</Notice> : null}

        <div className="adm-filters">
          <label className="adm-filter">
            <span className="adm-filter__label">搜道号</span>
            <input
              className="adm-input"
              value={q}
              placeholder="输入道号片段"
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="adm-filter">
            <span className="adm-filter__label">原型</span>
            <select
              className="adm-input"
              value={archetypeId}
              onChange={(event) => {
                setArchetypeId(event.target.value);
                setPage(1);
              }}
            >
              {archetypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="adm-filter">
            <span className="adm-filter__label">排序</span>
            <select
              className="adm-input"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as typeof sort);
                setPage(1);
              }}
            >
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="adm-btn"
            onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
          >
            {order === 'desc' ? '由高到低' : '由低到高'}
          </button>
        </div>

        <TableScroll>
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">道号</th>
                <th scope="col">原型</th>
                <th scope="col">境界</th>
                <th scope="col">修为</th>
                <th scope="col">战力</th>
                <th scope="col">论道分</th>
                <th scope="col">灵根</th>
                <th scope="col">天资</th>
                <th scope="col">勤勉</th>
                <th scope="col">好斗</th>
                <th scope="col">上次结算</th>
              </tr>
            </thead>
            <tbody>
              {(bots.data?.items ?? []).map((bot) => (
                <BotRow
                  key={bot.characterId}
                  bot={bot}
                  open={openId === bot.characterId}
                  onToggle={() =>
                    setOpenId((current) => (current === bot.characterId ? null : bot.characterId))
                  }
                  archetypes={(archetypes.data?.archetypes ?? []).map((a) => ({
                    value: a.id,
                    label: a.name,
                  }))}
                  onSaved={(next) => {
                    if (!bots.data) return;
                    bots.set({
                      ...bots.data,
                      items: bots.data.items.map((b) =>
                        b.characterId === next.characterId ? next : b,
                      ),
                    });
                    setFlash(`${next.name} 的参数已写入，下一息生效。`);
                  }}
                  onDeleted={() => {
                    setFlash(`${bot.name} 已从名册中除名。`);
                    refresh();
                  }}
                />
              ))}
              {bots.data && bots.data.items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="adm-empty">
                    {q || archetypeId ? '没有符合条件的机器人。' : '名册是空的。先批量生成一批。'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScroll>

        {bots.data ? (
          <Pager
            page={bots.data.page}
            pageSize={bots.data.pageSize}
            total={bots.data.total}
            onPage={setPage}
          />
        ) : null}
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- 单行编辑 */

function BotRow({
  bot,
  open,
  onToggle,
  archetypes,
  onSaved,
  onDeleted,
}: {
  bot: BotSummary;
  open: boolean;
  onToggle: () => void;
  archetypes: { value: string; label: string }[];
  onSaved: (next: BotSummary) => void;
  onDeleted: () => void;
}) {
  const required = getStage(bot.stageIndex).expRequired;
  return (
    <>
      <tr className={`adm-row${open ? ' is-open' : ''}`}>
        <th scope="row" className="adm-row__name">
          <button type="button" className="adm-row__toggle" onClick={onToggle} aria-expanded={open}>
            <span className="adm-row__chevron" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            {bot.name}
          </button>
        </th>
        <td>{bot.archetypeName ?? '—'}</td>
        <td>{bot.stageName}</td>
        <td className="numeral">
          {Math.round(bot.exp)} / {required}
        </td>
        <td className="numeral">{bot.powerScore}</td>
        <td className="numeral">{bot.arenaRating}</td>
        <td>{spiritRootName(bot.spiritRoot)}</td>
        <td className="numeral">{bot.params.talent}</td>
        <td className="numeral">{bot.params.diligence}</td>
        <td className="numeral">{bot.params.aggression}</td>
        <td className="numeral adm-cell--soft">{stamp(bot.lastSettledAt)}</td>
      </tr>
      {open ? (
        <tr className="adm-row__drawer">
          <td colSpan={11}>
            <BotEditor
              bot={bot}
              archetypes={archetypes}
              onSaved={onSaved}
              onDeleted={onDeleted}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BotEditor({
  bot,
  archetypes,
  onSaved,
  onDeleted,
}: {
  bot: BotSummary;
  archetypes: { value: string; label: string }[];
  onSaved: (next: BotSummary) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState({
    name: bot.name,
    archetypeId: bot.archetypeId ?? '',
    stageIndex: bot.stageIndex,
    exp: Math.round(bot.exp),
    params: { ...bot.params },
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const setParam = <K extends keyof BotParams>(key: K, value: BotParams[K]): void =>
    setDraft((d) => ({ ...d, params: { ...d.params, [key]: value } }));

  const save = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const next = await adminApi.updateBot({
        characterId: bot.characterId,
        params: draft.params,
        stageIndex: draft.stageIndex,
        exp: draft.exp,
        ...(draft.name !== bot.name ? { name: draft.name } : {}),
        ...(draft.archetypeId && draft.archetypeId !== bot.archetypeId
          ? { archetypeId: draft.archetypeId }
          : {}),
      });
      onSaved(next);
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await adminApi.deleteBot(bot.characterId);
      onDeleted();
    } catch (cause) {
      setFailure(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <div className="adm-editor">
      <div className="adm-grid">
        <TextField
          label="道号"
          value={draft.name}
          onChange={(name) => setDraft((d) => ({ ...d, name }))}
          maxLength={16}
          dirty={draft.name !== bot.name}
          hint="全服唯一。"
        />
        <SelectField
          label="原型"
          value={draft.archetypeId}
          onChange={(archetypeId) => setDraft((d) => ({ ...d, archetypeId }))}
          options={archetypes}
          dirty={draft.archetypeId !== (bot.archetypeId ?? '')}
          hint="换原型会一并套用该原型的整组参数。"
        />
        <NumField
          label="境界"
          value={draft.stageIndex}
          onChange={(stageIndex) => setDraft((d) => ({ ...d, stageIndex }))}
          min={0}
          max={MAX_STAGE_INDEX}
          step={1}
          dirty={draft.stageIndex !== bot.stageIndex}
          hint={stageName(draft.stageIndex)}
        />
        <NumField
          label="修为"
          value={draft.exp}
          onChange={(exp) => setDraft((d) => ({ ...d, exp }))}
          min={0}
          max={getStage(draft.stageIndex).expRequired}
          step={10}
          dirty={Math.round(bot.exp) !== draft.exp}
          hint="超出当前境界所需会被截到上限。"
        />
      </div>

      <div className="adm-grid">
        <NumField
          label="天资 talent"
          value={draft.params.talent}
          onChange={(v) => setParam('talent', v)}
          min={0.1}
          max={10}
          step={0.1}
          dirty={draft.params.talent !== bot.params.talent}
          hint="修炼速率倍率。天骄 2.5，散修 0.8。这是「强」与「弱」的主刻度。"
        />
        <NumField
          label="勤勉 diligence"
          value={draft.params.diligence}
          onChange={(v) => setParam('diligence', v)}
          min={0}
          max={1}
          step={0.05}
          dirty={draft.params.diligence !== bot.params.diligence}
          hint="活跃时段内真正在修炼的比例。苦修 1.0，纨绔 0.3。"
        />
        <NumField
          label="悟性 insight"
          value={draft.params.insight}
          onChange={(v) => setParam('insight', v)}
          min={-0.5}
          max={0.5}
          step={0.01}
          dirty={draft.params.insight !== bot.params.insight}
          hint="突破成功率的加法修正，0.15 即 +15 个百分点；同时也乘进修炼速率。"
        />
        <NumField
          label="好斗 aggression"
          value={draft.params.aggression}
          onChange={(v) => setParam('aggression', v)}
          min={0}
          max={1}
          step={0.05}
          dirty={draft.params.aggression !== bot.params.aggression}
          hint="每一息选择动手而非修炼的概率。调高会明显增加论道场的战报。"
        />
        <NumField
          label="活跃起点"
          value={draft.params.activeHours[0]}
          onChange={(v) => setParam('activeHours', [Math.round(v), draft.params.activeHours[1]])}
          min={0}
          max={23}
          step={1}
          unit="时"
          dirty={draft.params.activeHours[0] !== bot.params.activeHours[0]}
          hint="UTC 时。可跨午夜，例如 18 → 6。"
        />
        <NumField
          label="活跃终点"
          value={draft.params.activeHours[1]}
          onChange={(v) => setParam('activeHours', [draft.params.activeHours[0], Math.round(v)])}
          min={0}
          max={24}
          step={1}
          unit="时"
          dirty={draft.params.activeHours[1] !== bot.params.activeHours[1]}
          hint="24 表示到日终。0 – 24 即全天在线。"
        />
        <SelectField
          label="偏好"
          value={draft.params.explorePref}
          onChange={(v) => setParam('explorePref', v as BotParams['explorePref'])}
          options={Object.entries(PREF_LABELS).map(([value, label]) => ({ value, label }))}
          dirty={draft.params.explorePref !== bot.params.explorePref}
          hint="不修炼时优先做的事。"
        />
      </div>

      {failure ? <Notice tone="warn">{failure}</Notice> : null}

      <div className="adm-editor__foot">
        <span className="adm-editor__id numeral">{bot.characterId}</span>
        <span className="adm-editor__actions">
          {confirming ? (
            <>
              <span className="adm-editor__warn">删除后不可恢复，其战绩与排名一并消失。</span>
              <button
                type="button"
                className="adm-btn adm-btn--quiet"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--danger"
                onClick={() => void remove()}
                disabled={busy}
              >
                确认删除
              </button>
            </>
          ) : (
            <button
              type="button"
              className="adm-btn adm-btn--quiet"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              删除
            </button>
          )}
          <button
            type="button"
            className="adm-btn adm-btn--seal"
            onClick={() => void save()}
            disabled={busy}
          >
            {busy ? '写入中……' : '写入参数'}
          </button>
        </span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- 批量生成 */

function Generate({
  options,
  onDone,
}: {
  options: { value: string; label: string }[];
  onDone: (created: number) => void;
}) {
  const [count, setCount] = useState(20);
  const [archetypeId, setArchetypeId] = useState('');
  const [minStageIndex, setMin] = useState(0);
  const [maxStageIndex, setMax] = useState(11);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await adminApi.generateBots({
        count,
        minStageIndex,
        maxStageIndex: Math.max(minStageIndex, maxStageIndex),
        ...(archetypeId ? { archetypeId } : {}),
        ...(seed.trim() !== '' && Number.isFinite(Number(seed)) ? { seed: Number(seed) } : {}),
      });
      onDone(result.created);
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="批量生成"
      lede="新人口按原型权重抽签，境界向低处倾斜——那才是一个真实服务器的金字塔。"
    >
      <div className="adm-grid">
        <NumField
          label="人数"
          value={count}
          onChange={setCount}
          min={1}
          max={1000}
          step={10}
          unit="人"
        />
        <SelectField
          label="原型"
          value={archetypeId}
          onChange={setArchetypeId}
          options={[{ value: '', label: '按权重抽签' }, ...options]}
          hint="指定原型则整批同型。"
        />
        <NumField
          label="境界下限"
          value={minStageIndex}
          onChange={setMin}
          min={0}
          max={MAX_STAGE_INDEX}
          step={1}
          hint={stageName(minStageIndex)}
        />
        <NumField
          label="境界上限"
          value={maxStageIndex}
          onChange={setMax}
          min={0}
          max={MAX_STAGE_INDEX}
          step={1}
          hint={stageName(Math.max(minStageIndex, maxStageIndex))}
        />
        <TextField
          label="随机种子"
          value={seed}
          onChange={setSeed}
          placeholder="留空即随机"
          hint="填入整数可重现同一批道号与灵根。"
        />
      </div>
      {failure ? <Notice tone="warn">{failure}</Notice> : null}
      <div className="adm-editor__foot">
        <span className="adm-editor__id">
          生成会立刻写库；机器人不会自动消失，只能显式删除。
        </span>
        <button
          type="button"
          className="adm-btn adm-btn--seal"
          onClick={() => void run()}
          disabled={busy}
        >
          {busy ? '开炉中……' : `生成 ${count} 人`}
        </button>
      </div>
    </Section>
  );
}
