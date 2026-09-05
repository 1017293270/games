import { useState } from 'react';
import { CloudRule } from '../../design';
import { useCharacterStore } from '../../store/character';
import { useSessionStore } from '../../store/session';
import { InventoryPanel } from '../inventory/InventoryPanel';
import { AttributesPanel } from './AttributesPanel';
import { SkillPanel } from './SkillPanel';
import { TechniquePanel } from './TechniquePanel';
import './character.css';

type Tab = 'stats' | 'skills' | 'bag';

const TABS: { id: Tab; label: string }[] = [
  { id: 'stats', label: '资质' },
  { id: 'skills', label: '神通' },
  { id: 'bag', label: '行囊' },
];

export function CharacterPage() {
  const view = useCharacterStore((state) => state.view);
  const logout = useSessionStore((state) => state.logout);
  const [tab, setTab] = useState<Tab>('stats');

  if (!view) return null;

  return (
    <div>
      <header className="page-head">
        <h1 className="page-head__title">己身</h1>
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={() => void logout()}
        >
          离山
        </button>
      </header>
      <CloudRule />

      <div className="segments" role="tablist" aria-label="角色分页">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`segment ${tab === entry.id ? 'segment--on' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="char-body">
        {tab === 'stats' && (
          <>
            <AttributesPanel view={view} />
            <TechniquePanel view={view} />
          </>
        )}
        {tab === 'skills' && <SkillPanel view={view} />}
        {tab === 'bag' && <InventoryPanel view={view} />}
      </div>
    </div>
  );
}
