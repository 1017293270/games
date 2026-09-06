import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_WORLD_SETTINGS, type WorldSettings, type WorldSettingsPatch } from '@xianxia/shared';
import { errorMessage } from '../api/http';
import { adminApi } from './api';
import { NumField, Notice, Section, TextArea, Toggle, useAsync } from './ui';

/**
 * 世界.
 *
 * Every knob is written back as a *patch* of the keys the operator actually
 * touched, so two people tuning different halves of the world cannot clobber
 * each other. The 朱批 strip at the foot names exactly those keys before they
 * are committed — on a twenty-seven-field form, "what am I about to change?" is
 * the only question worth answering.
 */

interface Knob {
  key: NumericKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

interface Switch {
  key: BooleanKey;
  label: string;
  hint: string;
}

interface Group {
  title: string;
  lede: string;
  /** Drawn above the knobs: a master switch is read before its consequences. */
  switches?: Switch[];
  knobs: Knob[];
}

type NumericKey = {
  [K in keyof WorldSettings]: WorldSettings[K] extends number ? K : never;
}[keyof WorldSettings];

type BooleanKey = {
  [K in keyof WorldSettings]: WorldSettings[K] extends boolean ? K : never;
}[keyof WorldSettings];

const GROUPS: Group[] = [
  {
    title: '修炼',
    lede: '决定一个道号从练气到渡劫要花多久。改动对所有人立即生效，下一次结算就按新值算。',
    knobs: [
      {
        key: 'cultivationMultiplier',
        label: '修炼速率倍率',
        hint: '1 = 设计基准。调到 2 全服修为翻倍；开服冲榜期常设 1.5–3。',
        min: 0,
        max: 100,
        step: 0.1,
      },
      {
        key: 'offlineCapHours',
        label: '离线结算上限',
        hint: '超过这段时长的离线时间直接作废。12 小时让人每天上线一次即可不亏。',
        min: 0,
        max: 720,
        step: 1,
        unit: '小时',
      },
      {
        key: 'breakthroughChanceMultiplier',
        label: '突破成功率倍率',
        hint: '乘在基础成功率上，最终仍受 95% 上限约束。1 以下会显著拉长高境界的停留时间。',
        min: 0,
        max: 10,
        step: 0.05,
      },
    ],
  },
  {
    title: '机器人',
    lede: '机器人修仙者是这个世界的人口。它们与玩家共用全部公式，只多一组参数。',
    knobs: [
      {
        key: 'botTickSeconds',
        label: '每息秒数',
        hint: '机器人循环的间隔。改动立即重排定时器，无需重启。200 个机器人一息约 20 毫秒。',
        min: 5,
        max: 3600,
        step: 5,
        unit: '秒',
      },
      {
        key: 'botCount',
        label: '机器人目标人数',
        hint: '每一息把人口补到这个数。调低不会删人——删除是「机器人」页的显式操作。',
        min: 0,
        max: 5000,
        step: 10,
        unit: '人',
      },
    ],
  },
  {
    title: '产出',
    lede: '掉落与奖励的三个总闸。经济一旦放开很难收回，建议小步调。',
    knobs: [
      {
        key: 'dropRateMultiplier',
        label: '掉落率倍率',
        hint: '乘在每条掉落概率上，单条仍不超过 100%。',
        min: 0,
        max: 10,
        step: 0.1,
      },
      {
        key: 'expRewardMultiplier',
        label: '战斗修为倍率',
        hint: '妖兽与 BOSS 给的修为。只影响战斗产出，不影响挂机修炼。',
        min: 0,
        max: 100,
        step: 0.1,
      },
      {
        key: 'stoneRewardMultiplier',
        label: '灵石倍率',
        hint: '所有来源的灵石收入。调高会同时抬高物价承受力。',
        min: 0,
        max: 100,
        step: 0.1,
      },
    ],
  },
  {
    title: '玩法上限',
    lede: '每日次数与战斗规模的硬约束。',
    knobs: [
      {
        key: 'dungeonDailyLimit',
        label: '秘境每日次数',
        hint: '每个角色每 UTC 日可进入秘境的次数。',
        min: 0,
        max: 100,
        step: 1,
        unit: '次',
      },
      {
        key: 'arenaDailyLimit',
        label: '论道每日次数',
        hint: '每个角色每 UTC 日可发起的论道。机器人也吃这个上限。',
        min: 0,
        max: 100,
        step: 1,
        unit: '次',
      },
      {
        key: 'raidRecoverMinutes',
        label: '围攻恢复时长',
        hint: '被围攻的机器人从残血回满所需的时间。调小等于让玩家反复刷同一个目标。',
        min: 0,
        max: 1440,
        step: 5,
        unit: '分钟',
      },
      {
        key: 'maxPartySize',
        label: '队伍上限',
        hint: '一支队伍的最大人数。秘境难度按满员设计。',
        min: 1,
        max: 8,
        step: 1,
        unit: '人',
      },
      {
        key: 'maxBattleRounds',
        label: '战斗回合上限',
        hint: '超过即判平局。调低会让高防低攻的组合更容易打成平手。',
        min: 5,
        max: 200,
        step: 5,
        unit: '回合',
      },
      {
        key: 'chatHistoryLimit',
        label: '世界频道留存',
        hint: '世界聊天保留的消息条数，超出的旧消息会被裁掉。',
        min: 0,
        max: 1000,
        step: 10,
        unit: '条',
      },
    ],
  },
  {
    title: '战斗大地图',
    lede: '四张图各跑一个持续模拟：妖兽按刷新点复活，修士自动寻怪出手，人下线了角色仍留在场上。这一组决定这个循环跑多快、场上有多挤。',
    knobs: [
      {
        key: 'zoneTickMs',
        label: '每步毫秒',
        hint: '地图模拟一步覆盖的时间。改动立刻重排定时器，无需重启。调小更跟手也更吃 CPU；250 已足够顺滑。',
        min: 100,
        max: 1000,
        step: 50,
        unit: '毫秒',
      },
      {
        key: 'zoneSnapshotHz',
        label: '每秒推帧',
        hint: '每张图每秒推给观众的增量帧数。客户端会插值，4 帧就看不出跳；房里没人时不序列化，机器人照打。',
        min: 1,
        max: 10,
        step: 1,
        unit: '帧',
      },
      {
        key: 'monsterDensity',
        label: '妖兽密度',
        hint: '乘在每个刷新点的数量上。调高只在下一次复活时兑现，不会凭空冒出一片。',
        min: 0.2,
        max: 3,
        step: 0.1,
      },
      {
        key: 'respawnMultiplier',
        label: '妖兽复活倍率',
        hint: '乘在每个刷新点的复活间隔上。小于 1 刷得更快，大于 1 更稀。',
        min: 0.2,
        max: 5,
        step: 0.1,
      },
      {
        key: 'bossIntervalMinutes',
        label: 'BOSS 间隔',
        hint: '一图一只，按这个间隔现身。场上已有 BOSS 时不打断它，下一次才按新值算。',
        min: 1,
        max: 720,
        step: 5,
        unit: '分钟',
      },
    ],
  },
  {
    title: '图内收益',
    lede: '地图是全自动的，所以它必须比手动玩法便宜——否则挂机打怪会盖过其余一切玩法。',
    knobs: [
      {
        key: 'zoneRewardScale',
        label: '地图收益折扣',
        hint: '地图击杀的修为、灵石与掉落概率都乘这个数，BOSS 不打折。自动战斗十几秒一杀，调到 1 等于挂机修炼的 6–9 倍。',
        min: 0,
        max: 10,
        step: 0.05,
      },
      {
        key: 'zoneOfflineYield',
        label: '离线留场收益',
        hint: '离线的属主留在图里时，收益在上面的折扣之外再乘这个数。0 = 离线不产出，1 = 与在线同酬。',
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
  {
    title: '图内生死',
    lede: '倒下之后会怎样，以及修士之间能不能动手。',
    switches: [
      {
        key: 'mapPvp',
        label: '图内互斗',
        hint: '开启后修士之间可以动手：机器人按好斗度挑境界 ±4 阶的在线玩家，离线与保护期内的人打不到。关闭立刻清空所有修士对修士的目标。',
      },
    ],
    knobs: [
      {
        key: 'mapPvpStoneLoss',
        label: '互斗灵石损失',
        hint: '被修士击杀时被搜走的灵石比例，0.05 = 5%。被妖兽杀死不掉灵石。',
        min: 0,
        max: 0.5,
        step: 0.01,
      },
      {
        key: 'mapDeathRespawnSec',
        label: '阵亡复活等待',
        hint: '倒下后回入口复活要等的秒数。复活满血，并获 60 秒免修士攻击。',
        min: 1,
        max: 120,
        step: 1,
        unit: '秒',
      },
    ],
  },
];

/** Keys shown outside the numeric groups, for the change summary's labels. */
const EXTRA_LABELS: Partial<Record<keyof WorldSettings, string>> = {
  registrationOpen: '开放注册',
  inviteRequired: '需要邀请码',
  announcement: '登录页公告',
};

function labelOf(key: keyof WorldSettings): string {
  for (const group of GROUPS) {
    const knob = group.knobs.find((k) => k.key === key);
    if (knob) return knob.label;
    const toggle = group.switches?.find((t) => t.key === key);
    if (toggle) return toggle.label;
  }
  return EXTRA_LABELS[key] ?? key;
}

export function World() {
  const settings = useAsync(() => adminApi.settings(), 'world');
  const [draft, setDraft] = useState<WorldSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const base = settings.data;
  const changed = useMemo<(keyof WorldSettings)[]>(() => {
    if (!base || !draft) return [];
    return (Object.keys(base) as (keyof WorldSettings)[]).filter((key) => base[key] !== draft[key]);
  }, [base, draft]);

  if (settings.error && !base) return <Notice tone="warn">{settings.error}</Notice>;
  if (!base || !draft) return <p className="adm-loading">正在展卷……</p>;

  const edit = <K extends keyof WorldSettings>(key: K, value: WorldSettings[K]): void => {
    setSaved(false);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const commit = async (): Promise<void> => {
    if (changed.length === 0) return;
    setSaving(true);
    setFailure(null);
    try {
      const patch: WorldSettingsPatch = {};
      for (const key of changed) {
        (patch as Record<string, unknown>)[key] = draft[key];
      }
      const next = await adminApi.saveSettings(patch);
      settings.set(next);
      setDraft(next);
      setSaved(true);
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = (): void => {
    setSaved(false);
    setDraft({ ...DEFAULT_WORLD_SETTINGS });
  };

  return (
    <>
      {GROUPS.map((group) => (
        <Section key={group.title} title={group.title} lede={group.lede}>
          <div className="adm-grid">
            {(group.switches ?? []).map((toggle) => (
              <Toggle
                key={toggle.key}
                label={toggle.label}
                hint={toggle.hint}
                value={draft[toggle.key]}
                onChange={(next) => edit(toggle.key, next)}
                dirty={base[toggle.key] !== draft[toggle.key]}
              />
            ))}
            {group.knobs.map((knob) => (
              <NumField
                key={knob.key}
                label={knob.label}
                hint={knob.hint}
                value={draft[knob.key]}
                onChange={(next) => edit(knob.key, next)}
                min={knob.min}
                max={knob.max}
                step={knob.step}
                {...(knob.unit ? { unit: knob.unit } : {})}
                dirty={base[knob.key] !== draft[knob.key]}
              />
            ))}
          </div>
        </Section>
      ))}

      <Section title="门禁" lede="谁能进来，以及进来之前会读到什么。">
        <div className="adm-grid">
          <Toggle
            label="开放注册"
            value={draft.registrationOpen}
            onChange={(next) => edit('registrationOpen', next)}
            hint="关闭后新注册一律被拒，已有账号不受影响。"
            dirty={base.registrationOpen !== draft.registrationOpen}
          />
          <Toggle
            label="需要邀请码"
            value={draft.inviteRequired}
            onChange={(next) => edit('inviteRequired', next)}
            hint="开启后注册必须持有效邀请码。到「邀请码」页发放。"
            dirty={base.inviteRequired !== draft.inviteRequired}
          />
        </div>
        <TextArea
          label="登录页公告"
          value={draft.announcement}
          onChange={(next) => edit('announcement', next)}
          hint="显示在登录页。留空即不显示。最多 500 字。"
          maxLength={500}
          dirty={base.announcement !== draft.announcement}
        />
      </Section>

      <div className={`adm-commit${changed.length > 0 ? ' is-open' : ''}`}>
        <div className="adm-commit__body">
          <span className="adm-commit__mark" aria-hidden="true">
            朱批
          </span>
          <span className="adm-commit__list">
            {changed.length === 0
              ? saved
                ? '已存档，世界即刻生效。'
                : '尚无改动。'
              : `${changed.length} 项待存档：${changed.map(labelOf).join('、')}`}
          </span>
          <span className="adm-commit__actions">
            <button
              type="button"
              className="adm-btn adm-btn--quiet"
              onClick={restoreDefaults}
              disabled={saving}
            >
              填入默认值
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--quiet"
              onClick={() => setDraft(base)}
              disabled={saving || changed.length === 0}
            >
              复原
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--seal"
              onClick={() => void commit()}
              disabled={saving || changed.length === 0}
            >
              {saving ? '存档中……' : '存档'}
            </button>
          </span>
        </div>
        {failure ? <Notice tone="warn">{failure}</Notice> : null}
      </div>
    </>
  );
}
