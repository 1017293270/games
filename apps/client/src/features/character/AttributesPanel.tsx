import {
  RATE_STAT_KEYS,
  spiritRootName,
  STAT_KEYS,
  STAT_NAMES,
  type CharacterView,
} from '@xianxia/shared';
import { ArtImage } from '../../art/ArtImage';
import { Panel } from '../../design';
import './character.css';

const RATE_KEYS = new Set<string>(RATE_STAT_KEYS);

function formatStat(key: string, value: number): string {
  if (RATE_KEYS.has(key)) return `${(value * 100).toFixed(1)}%`;
  return Math.round(value).toLocaleString('zh-CN');
}

export function AttributesPanel({ view }: { view: CharacterView }) {
  const { character, stats } = view;

  return (
    <>
      <Panel>
        <div className="identity">
          <div className="identity__art">
            <ArtImage id={character.avatarArt} label="" motif="portrait" />
          </div>
          <div className="identity__body">
            <h2 className="identity__name">{character.name}</h2>
            <span className="identity__stage ink-display">{view.stageName}</span>
            <span className={`identity__root identity__root--${character.spiritRoot.quality}`}>
              {spiritRootName(character.spiritRoot)}
            </span>
          </div>
          <div className="identity__power">
            <span className="identity__power-k">战力</span>
            <span className="identity__power-v numeral">
              {character.powerScore.toLocaleString('zh-CN')}
            </span>
            {/* 声望 only ever comes from 围攻, so a fresh cultivator has none. */}
            <span className="identity__fame" title="围攻斩敌所得">
              <span className="identity__fame-k">声望</span>
              <span className="numeral">{character.prestige.toLocaleString('zh-CN')}</span>
            </span>
          </div>
        </div>
      </Panel>

      <Panel title="八相" aside="装备与功法已计入">
        <div className="stats-grid">
          {STAT_KEYS.map((key) => (
            <div className="stat" key={key}>
              <span className="stat__k">{STAT_NAMES[key]}</span>
              <span className="stat__v numeral">{formatStat(key, stats[key])}</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
