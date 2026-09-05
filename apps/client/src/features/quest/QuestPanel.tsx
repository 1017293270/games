import { useState } from 'react';
import {
  ITEM_BY_ID,
  NPC_BY_ID,
  type QuestKind,
  type QuestListResponse,
  type QuestObjective,
  type QuestView,
} from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { Button, CloudRule } from '../../design';
import { useCharacterStore } from '../../store/character';
import { toast } from '../../store/ui';
import './quest.css';

export interface QuestPanelProps {
  quests: QuestListResponse | null;
  /** Refetches the list after an accept or a turn-in. */
  onReload: () => void | Promise<void>;
}

const KIND_LABEL: Record<QuestKind, string> = { main: '主线', side: '支线', daily: '日常' };

/** Mirrors the server's `objectiveTarget`; one-shot kinds count as 1. */
function objectiveTarget(objective: QuestObjective): number {
  switch (objective.type) {
    case 'kill_monster':
    case 'collect_item':
    case 'defeat_bot':
      return objective.count;
    default:
      return 1;
  }
}

const GROUPS: { kind: QuestKind; label: string }[] = [
  { kind: 'main', label: '主线' },
  { kind: 'side', label: '支线' },
  { kind: 'daily', label: '日常' },
];

/** `修为 5,000 · 灵石 400 · 聚气丹×3` */
function rewardParts(view: QuestView): string[] {
  const { reward } = view.quest;
  const parts: string[] = [];
  if (reward.exp > 0) parts.push(`修为 ${reward.exp.toLocaleString('zh-CN')}`);
  if (reward.spiritStones > 0) parts.push(`灵石 ${reward.spiritStones.toLocaleString('zh-CN')}`);
  for (const item of reward.items) {
    const name = ITEM_BY_ID.get(item.itemId)?.name ?? item.itemId;
    parts.push(item.qty > 1 ? `${name}×${item.qty}` : name);
  }
  return parts;
}

/**
 * 任务簿.
 *
 * Everything shown here is the server's judgement: `claimable`, the per-objective
 * `objectiveText`, which quests are on offer at all. The panel adds grouping and
 * the two buttons.
 */
export function QuestPanel({ quests, onReload }: QuestPanelProps) {
  const setView = useCharacterStore((state) => state.setView);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (questId: string, kind: 'accept' | 'complete') => {
    setBusy(questId);
    try {
      if (kind === 'accept') {
        await api.acceptQuest(questId);
        toast('已接下这桩差事', 'info');
      } else {
        const result = await api.completeQuest(questId);
        setView(result.view);
        const parts = [
          result.reward.exp > 0 ? `修为 +${result.reward.exp.toLocaleString('zh-CN')}` : '',
          result.reward.spiritStones > 0 ? `灵石 +${result.reward.spiritStones}` : '',
          ...result.reward.itemNames,
        ].filter(Boolean);
        toast(parts.length > 0 ? `复命得 ${parts.join('，')}` : '复命完毕', 'gain');
        if (result.advancedToChapter !== null) {
          toast(`剧情推进至第 ${result.advancedToChapter} 章`, 'info');
        }
      }
      await onReload();
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setBusy(null);
    }
  };

  if (!quests) return <p className="empty">正在翻开任务簿……</p>;

  const chapter = quests.chapters.find((c) => c.chapter === quests.currentChapter);
  const board = [...quests.active, ...quests.available];
  const claimed = quests.claimed;

  return (
    <div className="quests">
      {chapter && (
        <section className="chapter">
          <h2 className="chapter__title">{chapter.title}</h2>
          <p className="chapter__summary">{chapter.summary}</p>
        </section>
      )}

      {GROUPS.map(({ kind, label }) => {
        const rows = board.filter((q) => q.quest.kind === kind);
        if (rows.length === 0) return null;
        return (
          <section className="quest-group" key={kind}>
            <header className="quest-group__head">
              <h3 className="quest-group__label">{label}</h3>
              <span className="quest-group__count">{rows.length} 条</span>
            </header>
            <div className="quest-group__list">
              {rows.map((row) => (
                <QuestRow
                  key={row.quest.id}
                  row={row}
                  busy={busy === row.quest.id}
                  onAct={(mode) => void act(row.quest.id, mode)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {board.length === 0 && <p className="empty">镇上暂时无事可做，先去山河图走走。</p>}

      {claimed.length > 0 && (
        <>
          <CloudRule />
          <section className="quest-group">
            <header className="quest-group__head">
              <h3 className="quest-group__label">已了</h3>
              <span className="quest-group__count">{claimed.length} 条</span>
            </header>
            <div className="quest-group__list">
              {claimed.map((row) => (
                <div className="quest quest--claimed" key={row.quest.id}>
                  <div className="quest__head">
                    <span className="quest__name">{row.quest.name}</span>
                    <span className="quest__kind">{KIND_LABEL[row.quest.kind]}</span>
                    <span className="quest__giver">已复命</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function QuestRow({
  row,
  busy,
  onAct,
}: {
  row: QuestView;
  busy: boolean;
  onAct: (mode: 'accept' | 'complete') => void;
}) {
  const accepted = row.progress.state === 'active' || row.progress.state === 'completed';
  const giver = NPC_BY_ID.get(row.quest.giverNpcId)?.name ?? row.quest.giverNpcId;
  const turnIn = NPC_BY_ID.get(row.quest.turnInNpcId)?.name ?? row.quest.turnInNpcId;

  return (
    <article className={`quest ${row.claimable ? 'quest--claimable' : ''}`}>
      <div className="quest__head">
        <span className="quest__name">{row.quest.name}</span>
        <span className={`quest__kind quest__kind--${row.quest.kind}`}>
          {KIND_LABEL[row.quest.kind]}
        </span>
        <span className="quest__giver">{accepted ? `复命 · ${turnIn}` : `发布 · ${giver}`}</span>
      </div>

      <p className="quest__desc">{row.quest.description}</p>

      {accepted && (
        <ul className="quest__objectives">
          {row.objectiveText.map((text, i) => {
            const objective = row.quest.objectives[i];
            const done =
              objective !== undefined &&
              (row.progress.counters[i] ?? 0) >= objectiveTarget(objective);
            return (
              <li
                className={`quest__objective ${done ? 'quest__objective--done' : ''}`}
                key={`${row.quest.id}-${String(i)}`}
              >
                {text}
              </li>
            );
          })}
        </ul>
      )}

      <div className="quest__reward">
        {rewardParts(row).map((part) => (
          <span key={part}>{part}</span>
        ))}
      </div>

      <div className="quest__foot">
        {row.claimable && <span className="quest__gate">目标已达成，可去复命</span>}
        {accepted ? (
          <Button
            variant={row.claimable ? 'seal' : 'ghost'}
            size="sm"
            disabled={busy || !row.claimable}
            onClick={() => onAct('complete')}
          >
            {row.claimable ? '复命领赏' : '进行中'}
          </Button>
        ) : (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => onAct('accept')}>
            接下
          </Button>
        )}
      </div>
    </article>
  );
}
