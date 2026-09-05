import { useState } from 'react';
import {
  ITEM_GRADE_NAMES,
  stageName,
  TECHNIQUES,
  TECHNIQUE_BY_ID,
  type CharacterView,
  type Technique,
} from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { Button, Panel } from '../../design';
import { useCharacterStore } from '../../store/character';
import { toast } from '../../store/ui';
import './character.css';

function summarise(technique: Technique): string {
  const bits = [`修炼 +${Math.round(technique.cultivationBonus * 100)}%`];
  for (const [key, label] of [
    ['hp', '气血'],
    ['atk', '攻击'],
    ['def', '防御'],
    ['spd', '速度'],
  ] as const) {
    const value = technique.percent[key];
    if (value) bits.push(`${label} ${value > 0 ? '+' : ''}${Math.round(value * 100)}%`);
  }
  return bits.join(' · ');
}

export function TechniquePanel({ view }: { view: CharacterView }) {
  const setView = useCharacterStore((state) => state.setView);
  const [busy, setBusy] = useState(false);
  const { character } = view;
  const current = character.techniqueId ? TECHNIQUE_BY_ID.get(character.techniqueId) : undefined;

  const act = async (technique: Technique) => {
    setBusy(true);
    try {
      const learned = character.learnedTechniqueIds.includes(technique.id);
      setView(learned ? await api.setTechnique(technique.id) : await api.learnTechnique(technique.id));
      toast(learned ? `改修 ${technique.name}` : `已参悟 ${technique.name}`, 'gain');
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="功法" aside={current ? `正修 ${current.name}` : '未择功法'}>
      {TECHNIQUES.map((technique) => {
        const learned = character.learnedTechniqueIds.includes(technique.id);
        const active = character.techniqueId === technique.id;
        const gated = character.stageIndex < technique.requiredStage;
        return (
          <div className={`tech-row ${active ? 'tech-row--on' : ''}`} key={technique.id}>
            <span className="tech-row__body">
              <span className="tech-row__name">
                {technique.name}
                <span className={`grade-mark grade-mark--${technique.grade}`}>
                  {ITEM_GRADE_NAMES[technique.grade]}
                </span>
              </span>
              <span className="tech-row__note">{summarise(technique)}</span>
              <span className="tech-row__note tech-row__note--desc">{technique.description}</span>
            </span>
            {active ? (
              <span className="skill-row__tag">正修</span>
            ) : gated ? (
              <span className="skill-row__tag">需 {stageName(technique.requiredStage)}</span>
            ) : (
              <Button
                size="sm"
                disabled={busy || (!learned && character.spiritStones < technique.learnCost)}
                onClick={() => void act(technique)}
              >
                {learned ? '改修' : `${technique.learnCost.toLocaleString('zh-CN')} 灵石`}
              </Button>
            )}
          </div>
        );
      })}
    </Panel>
  );
}
