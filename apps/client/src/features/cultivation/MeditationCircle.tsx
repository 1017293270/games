import { SUB_STAGE_NAMES, subOf } from '@xianxia/shared';
import type { CharacterView } from '@xianxia/shared';
import { ArtImage } from '../../art/ArtImage';

const R = 88;
const CIRCUMFERENCE = 2 * Math.PI * R;

export interface MeditationCircleProps {
  view: CharacterView;
  /** 0-1 progress through the current stage. */
  progress: number;
  atPerfection: boolean;
}

/**
 * 运气周天 — the signature element.
 *
 * The cultivator sits inside a circuit of qi. The heavy stroke is the current
 * stage's 修为, drawn from the top clockwise; the spark riding it is the
 * circulation itself, and it speeds up once the stage is full. The four ticks
 * outside are the 小境界 of this 大境界 — filled for the ones already crossed —
 * so the ring answers both "how far in this stage" and "how far in this realm".
 */
export function MeditationCircle({ view, progress, atPerfection }: MeditationCircleProps) {
  const sub = subOf(view.character.stageIndex);
  const dashOffset = CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, progress)));
  const figure = view.character.gender === 'female' ? 'char/meditate-f' : 'char/meditate-m';

  return (
    <div className={`zhoutian ${atPerfection ? 'zhoutian--full' : ''}`}>
      <svg className="zhoutian__ring" viewBox="0 0 200 200" aria-hidden="true">
        <circle className="zhoutian__halo" cx="100" cy="100" r={R} />
        <circle className="zhoutian__trough" cx="100" cy="100" r={R} />
        <circle
          className="zhoutian__progress"
          cx="100"
          cy="100"
          r={R}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 100 100)"
        />
        <g className="zhoutian__orbit">
          <circle className="zhoutian__spark" cx="100" cy={100 - R} r="3.4" />
        </g>
        {SUB_STAGE_NAMES.map((label, index) => {
          const angle = (index / SUB_STAGE_NAMES.length) * Math.PI * 2 - Math.PI / 2;
          const inner = R + 8;
          const outer = R + 15;
          const state = index < sub ? 'done' : index === sub ? 'now' : 'todo';
          return (
            <line
              key={label}
              className={`zhoutian__tick zhoutian__tick--${state}`}
              x1={100 + Math.cos(angle) * inner}
              y1={100 + Math.sin(angle) * inner}
              x2={100 + Math.cos(angle) * outer}
              y2={100 + Math.sin(angle) * outer}
            />
          );
        })}
      </svg>
      <div className="zhoutian__figure">
        <ArtImage id={figure} label="" motif="figure" />
      </div>
    </div>
  );
}
