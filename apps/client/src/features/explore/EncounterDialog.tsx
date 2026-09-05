import { useState } from 'react';
import type { Encounter, EncounterChoiceResponse } from '@xianxia/shared';
import { stageName } from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { ArtImage } from '../../art/ArtImage';
import { Button, Modal } from '../../design';
import { useCharacterStore } from '../../store/character';
import { toast } from '../../store/ui';
import './explore.css';

export interface EncounterDialogProps {
  encounter: Encounter;
  token: string;
  onClose: () => void;
}

/**
 * 奇遇. Conditions are evaluated server-side; the client only greys out a
 * choice and says why, so an option can never be forged from here.
 */
export function EncounterDialog({ encounter, token, onClose }: EncounterDialogProps) {
  const setView = useCharacterStore((state) => state.setView);
  const view = useCharacterStore((state) => state.view);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<EncounterChoiceResponse | null>(null);

  const gateOf = (conditions: Encounter['options'][number]['conditions']): string | null => {
    for (const condition of conditions) {
      if (condition.type === 'spirit_stones_at_least') {
        if ((view?.character.spiritStones ?? 0) < condition.amount) {
          return `需 ${condition.amount.toLocaleString('zh-CN')} 灵石`;
        }
      }
      if (condition.type === 'stage_at_least') {
        if ((view?.character.stageIndex ?? 0) < condition.stageIndex) {
          return `需 ${stageName(condition.stageIndex)}`;
        }
      }
    }
    return null;
  };

  const choose = async (optionId: string) => {
    setBusy(true);
    try {
      const response = await api.chooseEncounter({ encounterToken: token, optionId });
      setView(response.view);
      setOutcome(response);
    } catch (error) {
      toast(errorMessage(error), 'warn');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (outcome) {
    const { reward } = outcome;
    return (
      <Modal open title={encounter.name} onClose={onClose} dismissable={false}>
        <p className="encounter__outcome">{outcome.outcomeText}</p>
        <div className="spoils">
          {reward.exp > 0 && (
            <span className="spoil">修为 +{reward.exp.toLocaleString('zh-CN')}</span>
          )}
          {reward.spiritStones > 0 && (
            <span className="spoil">灵石 +{reward.spiritStones.toLocaleString('zh-CN')}</span>
          )}
          {reward.itemNames.map((name) => (
            <span className="spoil spoil--gold" key={name}>
              {name}
            </span>
          ))}
        </div>
        <Button variant="primary" block onClick={onClose} style={{ marginTop: 'var(--sp-4)' }}>
          继续前行
        </Button>
      </Modal>
    );
  }

  return (
    <Modal open title={encounter.name} onClose={onClose} dismissable={false}>
      {encounter.art && (
        <div
          style={{
            aspectRatio: '16 / 9',
            overflow: 'hidden',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--ink-hair)',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <ArtImage id={encounter.art} label={encounter.name} motif="scene" small />
        </div>
      )}
      <p className="encounter__text">{encounter.text}</p>
      <div className="encounter__options">
        {encounter.options.map((option) => {
          const gate = gateOf(option.conditions);
          return (
            <button
              key={option.id}
              type="button"
              className="choice"
              disabled={busy || Boolean(gate)}
              onClick={() => void choose(option.id)}
            >
              {option.text}
              {gate && <span className="choice__gate">{gate}</span>}
            </button>
          );
        })}
      </div>
      <p className="field__hint" style={{ marginTop: 'var(--sp-3)' }}>
        机缘各有其价，没有一条路是白走的。
      </p>
    </Modal>
  );
}
