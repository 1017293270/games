import { ProgressionHub } from '../progression/ProgressionHub';
import { useState } from 'react';
import {
  breakthroughChance,
  formatDuration,
  getTechnique,
  ITEM_BY_ID,
  spiritRootName,
} from '@xianxia/shared';
import { VividScene } from '../../art/VividScene';
import { ArtImage } from '../../art/ArtImage';
import { Button, Sheet } from '../../design';
import { DAY_END_HOUR, DAY_START_HOUR } from '../../config';
import { useCharacterStore } from '../../store/character';
import { useInventoryStore } from '../../store/inventory';
import { BreakthroughModal } from './BreakthroughModal';
import { MeditationCircle } from './MeditationCircle';
import { QiParticles } from './QiParticles';
import { useLiveCultivation } from './useLiveCultivation';
import './cultivation.css';

export function CultivationPage() {
  const view = useCharacterStore((state) => state.view);
  const usePill = useInventoryStore((state) => state.use);
  const live = useLiveCultivation();
  const [breaking, setBreaking] = useState(false);
  const [pillsOpen, setPillsOpen] = useState(false);

  if (!view) return null;

  const hour = new Date().getHours();
  const daytime = hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
  const technique = getTechnique(view.character.techniqueId);
  const chance = breakthroughChance(view.character.stageIndex, 0);
  const pills = view.inventory.filter((row) => ITEM_BY_ID.get(row.itemId)?.kind === 'pill');

  return (
    <div className="cultivation">
      <section className="cultivation__stage">
        <div className={`cultivation__bg ${daytime ? '' : 'cultivation__bg--night'}`}>
          <VividScene
            label="星海云山 · 洞府"
            fallback={
              <ArtImage
                id={daytime ? 'bg/cultivation-day' : 'bg/cultivation-night'}
                label={daytime ? '云海山巅·昼' : '云海山巅·夜'}
                motif="scene"
                small
              />
            }
          />
        </div>
        <QiParticles tone={daytime ? 'day' : 'night'} />

        <MeditationCircle view={view} progress={live.progress} atPerfection={live.atPerfection} />

        <div className="cultivation__plate">
          <h1 className="cultivation__stagename">{view.stageName}</h1>
          {live.atPerfection ? (
            <p className="cultivation__eta cultivation__eta--full">修为已满，只待一念破境</p>
          ) : (
            <p className="cultivation__eta numeral">距下一境 {formatDuration(live.remainingSec)}</p>
          )}
        </div>
      </section>

      <ProgressionHub />
      <section className="cultivation__deck">
        {view.character.buffs.length > 0 && (
          <div className="buffs">
            {view.character.buffs.map((buff) => (
              <span key={buff.id} className="buff-chip">
                {ITEM_BY_ID.get(buff.itemId)?.name ?? '丹力'} +{Math.round(buff.bonus * 100)}%
                <span className="muted numeral">
                  {formatDuration((buff.expiresAt - Date.now()) / 1000)}
                </span>
              </span>
            ))}
          </div>
        )}

        <div className="readouts">
          <div className="readout">
            <span className="readout__k">修炼速率</span>
            <span className="readout__v numeral">
              {live.ratePerSec.toFixed(1)}
              <small>/秒</small>
            </span>
          </div>
          <div className="readout">
            <span className="readout__k">灵根</span>
            <span className="readout__v">{spiritRootName(view.character.spiritRoot)}</span>
          </div>
          <div className="readout">
            <span className="readout__k">功法</span>
            <span className="readout__v">{technique?.name ?? '未修'}</span>
          </div>
        </div>

        {live.atPerfection ? (
          <Button variant="seal" block onClick={() => setBreaking(true)}>
            运功破境 · 成算 {Math.round(chance * 100)}%
          </Button>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Button variant="ghost" block onClick={() => setPillsOpen(true)}>
              取丹服用
            </Button>
          </div>
        )}
      </section>

      <BreakthroughModal open={breaking} onClose={() => setBreaking(false)} />

      <Sheet open={pillsOpen} title="丹房" onClose={() => setPillsOpen(false)}>
        {pills.length === 0 ? (
          <p className="empty">囊中无丹。去探索采药，或向药王讨要。</p>
        ) : (
          <ul className="item-list">
            {pills.map((row) => {
              const item = ITEM_BY_ID.get(row.itemId);
              if (!item) return null;
              return (
                <li key={row.uid} className="item-row">
                  <span className="item-row__art">
                    <ArtImage id={item.art} label="" motif="token" />
                  </span>
                  <span className="item-row__body">
                    <span className="item-row__name">
                      {item.name}
                      <span className="muted numeral"> ×{row.qty}</span>
                    </span>
                    <span className="item-row__desc muted">{item.description}</span>
                  </span>
                  <Button
                    size="sm"
                    onClick={() => {
                      void usePill(row.uid);
                      setPillsOpen(false);
                    }}
                  >
                    服下
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
