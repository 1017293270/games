import { useState } from 'react';
import type { BotArchetype, BotParams } from '@xianxia/shared';
import { errorMessage } from '../api/http';
import { adminApi } from './api';
import { NumField, Notice, Section, SelectField, TextArea, TextField, useAsync } from './ui';

/**
 * 原型.
 *
 * An archetype is the template a newly generated bot is stamped from — 天骄
 * cultivates fast and rarely fights, 苦修 never stops, 纨绔 barely starts.
 * Editing one changes who gets *generated next*; it does not retroactively
 * retune the cultivators already walking around, which is what keeps a
 * player's ranking history meaningful.
 */

const PREF_LABELS: Record<BotParams['explorePref'], string> = {
  cultivate: '专修',
  explore: '探索',
  dungeon: '秘境',
  arena: '论道',
};

export function Archetypes() {
  const archetypes = useAsync(() => adminApi.archetypes(), 'archetypes');
  const [flash, setFlash] = useState<string | null>(null);

  if (archetypes.error && !archetypes.data) return <Notice tone="warn">{archetypes.error}</Notice>;
  if (!archetypes.data) return <p className="adm-loading">正在展卷……</p>;

  const total = archetypes.data.archetypes.reduce((sum, a) => sum + a.weight, 0);

  return (
    <Section
      title="原型"
      lede="六种修行路数。权重决定抽签概率，参数决定这一路数的强弱与作息。"
      actions={
        <button type="button" className="adm-btn adm-btn--quiet" onClick={archetypes.reload}>
          重读
        </button>
      }
    >
      {flash ? <Notice tone="done">{flash}</Notice> : null}
      <div className="adm-archetypes">
        {archetypes.data.archetypes.map((archetype) => (
          <ArchetypeCard
            key={archetype.id}
            archetype={archetype}
            share={total > 0 ? archetype.weight / total : 0}
            onSaved={(next) => {
              archetypes.set({ archetypes: next });
              setFlash(`${archetype.name} 已写入，此后生成的机器人按新模板铸造。`);
            }}
          />
        ))}
      </div>
    </Section>
  );
}

function ArchetypeCard({
  archetype,
  share,
  onSaved,
}: {
  archetype: BotArchetype;
  share: number;
  onSaved: (next: BotArchetype[]) => void;
}) {
  const [draft, setDraft] = useState({
    name: archetype.name,
    description: archetype.description,
    weight: archetype.weight,
    params: { ...archetype.params },
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const setParam = <K extends keyof BotParams>(key: K, value: BotParams[K]): void =>
    setDraft((d) => ({ ...d, params: { ...d.params, [key]: value } }));

  const dirty =
    draft.name !== archetype.name ||
    draft.description !== archetype.description ||
    draft.weight !== archetype.weight ||
    (Object.keys(draft.params) as (keyof BotParams)[]).some((key) =>
      key === 'activeHours'
        ? draft.params.activeHours[0] !== archetype.params.activeHours[0] ||
          draft.params.activeHours[1] !== archetype.params.activeHours[1]
        : draft.params[key] !== archetype.params[key],
    );

  const save = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await adminApi.updateArchetype({
        id: archetype.id,
        name: draft.name,
        description: draft.description,
        weight: draft.weight,
        params: draft.params,
      });
      onSaved(result.archetypes);
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`adm-card${dirty ? ' is-dirty' : ''}`}>
      <header className="adm-card__head">
        <h3 className="adm-card__title ink-display">{archetype.name}</h3>
        <span className="adm-card__share numeral">抽中率 {(share * 100).toFixed(1)}%</span>
      </header>

      <div className="adm-grid adm-grid--tight">
        <TextField
          label="名称"
          value={draft.name}
          onChange={(name) => setDraft((d) => ({ ...d, name }))}
          dirty={draft.name !== archetype.name}
        />
        <NumField
          label="权重"
          value={draft.weight}
          onChange={(weight) => setDraft((d) => ({ ...d, weight }))}
          min={0.1}
          max={100}
          step={0.5}
          dirty={draft.weight !== archetype.weight}
          hint="相对频率，与其它原型相除得到抽中率。"
        />
        <NumField
          label="天资"
          value={draft.params.talent}
          onChange={(v) => setParam('talent', v)}
          min={0.1}
          max={10}
          step={0.1}
          dirty={draft.params.talent !== archetype.params.talent}
        />
        <NumField
          label="勤勉"
          value={draft.params.diligence}
          onChange={(v) => setParam('diligence', v)}
          min={0}
          max={1}
          step={0.05}
          dirty={draft.params.diligence !== archetype.params.diligence}
        />
        <NumField
          label="悟性"
          value={draft.params.insight}
          onChange={(v) => setParam('insight', v)}
          min={-0.5}
          max={0.5}
          step={0.01}
          dirty={draft.params.insight !== archetype.params.insight}
        />
        <NumField
          label="好斗"
          value={draft.params.aggression}
          onChange={(v) => setParam('aggression', v)}
          min={0}
          max={1}
          step={0.05}
          dirty={draft.params.aggression !== archetype.params.aggression}
        />
        <NumField
          label="活跃起点"
          value={draft.params.activeHours[0]}
          onChange={(v) => setParam('activeHours', [Math.round(v), draft.params.activeHours[1]])}
          min={0}
          max={23}
          step={1}
          unit="时"
          dirty={draft.params.activeHours[0] !== archetype.params.activeHours[0]}
        />
        <NumField
          label="活跃终点"
          value={draft.params.activeHours[1]}
          onChange={(v) => setParam('activeHours', [draft.params.activeHours[0], Math.round(v)])}
          min={0}
          max={24}
          step={1}
          unit="时"
          dirty={draft.params.activeHours[1] !== archetype.params.activeHours[1]}
        />
        <SelectField
          label="偏好"
          value={draft.params.explorePref}
          onChange={(v) => setParam('explorePref', v as BotParams['explorePref'])}
          options={Object.entries(PREF_LABELS).map(([value, label]) => ({ value, label }))}
          dirty={draft.params.explorePref !== archetype.params.explorePref}
        />
      </div>

      <TextArea
        label="说明"
        value={draft.description}
        onChange={(description) => setDraft((d) => ({ ...d, description }))}
        dirty={draft.description !== archetype.description}
      />

      {failure ? <Notice tone="warn">{failure}</Notice> : null}

      <div className="adm-card__foot">
        <span className="adm-editor__id numeral">{archetype.id}</span>
        <button
          type="button"
          className="adm-btn adm-btn--seal"
          onClick={() => void save()}
          disabled={busy || !dirty}
        >
          {busy ? '写入中……' : '写入原型'}
        </button>
      </div>
    </article>
  );
}
