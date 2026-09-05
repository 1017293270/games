import { useState } from 'react';
import {
  ELEMENT_NAMES,
  SKILL_BY_ID,
  SKILL_SLOT_COUNT,
  skillsAvailableAt,
  stageName,
  type CharacterView,
  type Skill,
} from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { Button, Panel, Sheet } from '../../design';
import { useCharacterStore } from '../../store/character';
import { toast } from '../../store/ui';
import './character.css';

const SLOT_ORDER = ['一', '二', '三', '四'];

function skillNote(skill: Skill): string {
  const bits = [`${ELEMENT_NAMES[skill.element]}·${skill.tier}层`, `灵力 ${skill.manaCost}`];
  if (skill.cooldown > 0) bits.push(`冷却 ${skill.cooldown}`);
  if (skill.type === 'damage' || skill.type === 'heal') bits.push(`系数 ${skill.power}`);
  return bits.join(' · ');
}

export function SkillPanel({ view }: { view: CharacterView }) {
  const setView = useCharacterStore((state) => state.setView);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const { character } = view;
  const learnable = skillsAvailableAt(character.stageIndex).filter(
    (skill) => !character.learnedSkillIds.includes(skill.id),
  );

  const assign = async (slot: number, skillId: string | null) => {
    setBusy(true);
    try {
      const slots = [...character.skillSlots];
      // A skill occupies one slot at a time; moving it clears the old one.
      for (let i = 0; i < slots.length; i += 1) {
        if (skillId && slots[i] === skillId) slots[i] = null;
      }
      slots[slot] = skillId;
      setView(await api.equipSkills(slots));
      setEditing(null);
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setBusy(false);
    }
  };

  const learn = async (skill: Skill) => {
    setBusy(true);
    try {
      setView(await api.learnSkill(skill.id));
      toast(`已习得 ${skill.name}`, 'gain');
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel title="神通" aside="按序轮转释放">
        <div className="slots">
          {Array.from({ length: SKILL_SLOT_COUNT }, (_, index) => {
            const skill = character.skillSlots[index]
              ? SKILL_BY_ID.get(character.skillSlots[index] as string)
              : undefined;
            return (
              <button
                key={index}
                type="button"
                className={`slot ${skill ? '' : 'slot--empty'}`}
                onClick={() => setEditing(index)}
              >
                <span className="slot__order">{SLOT_ORDER[index]}</span>
                <span className="slot__name">{skill?.name ?? '空槽'}</span>
                {skill && <span className="slot__el">{ELEMENT_NAMES[skill.element]}</span>}
              </button>
            );
          })}
        </div>
        <p className="field__hint" style={{ marginTop: 'var(--sp-3)' }}>
          战斗中从第一槽扫起，取第一个冷却好、灵力够的施展。四槽全填三层会灵力枯竭。
        </p>
      </Panel>

      <Panel title="可修习" aside={`${learnable.length} 门`}>
        {learnable.length === 0 ? (
          <p className="empty">当前境界的神通已尽数在握。</p>
        ) : (
          <div>
            {learnable.map((skill) => (
              <div className="skill-row" key={skill.id}>
                <span className="skill-row__el ink-display">{ELEMENT_NAMES[skill.element]}</span>
                <span className="skill-row__body">
                  <span className="skill-row__name">{skill.name}</span>
                  <span className="skill-row__note">{skill.description}</span>
                </span>
                <Button
                  size="sm"
                  disabled={busy || character.spiritStones < skill.learnCost}
                  onClick={() => void learn(skill)}
                >
                  {skill.learnCost > 0 ? `${skill.learnCost.toLocaleString('zh-CN')} 灵石` : '免费'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Sheet
        open={editing !== null}
        title={`第${SLOT_ORDER[editing ?? 0]}槽`}
        onClose={() => setEditing(null)}
      >
        <div>
          {character.learnedSkillIds.map((id) => {
            const skill = SKILL_BY_ID.get(id);
            if (!skill) return null;
            const equippedAt = character.skillSlots.indexOf(id);
            return (
              <button
                key={id}
                type="button"
                className="skill-row"
                disabled={busy}
                onClick={() => void assign(editing ?? 0, id)}
              >
                <span className="skill-row__el ink-display">{ELEMENT_NAMES[skill.element]}</span>
                <span className="skill-row__body">
                  <span className="skill-row__name">{skill.name}</span>
                  <span className="skill-row__note">{skillNote(skill)}</span>
                </span>
                <span className="skill-row__tag">
                  {equippedAt >= 0 ? `第${SLOT_ORDER[equippedAt]}槽` : `需 ${stageName(skill.unlockStage)}`}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          variant="quiet"
          block
          style={{ marginTop: 'var(--sp-3)' }}
          onClick={() => void assign(editing ?? 0, null)}
        >
          留空此槽
        </Button>
      </Sheet>
    </>
  );
}
