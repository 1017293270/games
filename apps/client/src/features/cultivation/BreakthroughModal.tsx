import { useMemo, useState } from 'react';
import {
  breakthroughChance,
  BREAKTHROUGH_PILL_ID,
  ITEM_BY_ID,
  MAX_BREAKTHROUGH_PILLS,
  requiresTribulation,
  tribulationAvatar,
  type BreakthroughResponse,
} from '@xianxia/shared';
import { Button, Modal } from '../../design';
import { useCharacterStore } from '../../store/character';
import { BattleReplay } from '../combat/BattleReplay';
import './cultivation.css';

type Phase = 'choose' | 'working' | 'tribulation' | 'result';

export function BreakthroughModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const view = useCharacterStore((state) => state.view);
  const breakthrough = useCharacterStore((state) => state.breakthrough);
  const [pills, setPills] = useState(0);
  const [phase, setPhase] = useState<Phase>('choose');
  const [result, setResult] = useState<BreakthroughResponse | null>(null);

  const owned = useMemo(
    () =>
      (view?.inventory ?? [])
        .filter((row) => row.itemId === BREAKTHROUGH_PILL_ID)
        .reduce((total, row) => total + row.qty, 0),
    [view],
  );

  if (!view) return null;

  const stageIndex = view.character.stageIndex;
  const maxPills = Math.min(MAX_BREAKTHROUGH_PILLS, owned);
  const chance = breakthroughChance(stageIndex, pills);
  const pillName = ITEM_BY_ID.get(BREAKTHROUGH_PILL_ID)?.name ?? '破境丹';
  const needsTribulation = requiresTribulation(stageIndex);

  const reset = () => {
    setPhase('choose');
    setResult(null);
    setPills(0);
    onClose();
  };

  const attempt = async () => {
    setPhase('working');
    const response = await breakthrough(pills);
    if (!response) {
      setPhase('choose');
      return;
    }
    setResult(response);
    setPhase(response.tribulation ? 'tribulation' : 'result');
  };

  if (phase === 'tribulation' && result?.tribulation) {
    const avatar = tribulationAvatar(result.fromStageIndex);
    return (
      <BattleReplay
        battle={result.tribulation}
        title="天劫"
        teamA={[
          {
            id: view.character.id,
            name: view.character.name,
            art: view.character.avatarArt,
            motif: 'portrait',
            maxHp: view.stats.hp,
          },
        ]}
        teamB={[
          { id: avatar.id, name: avatar.name, art: avatar.art, motif: 'beast', maxHp: avatar.stats.hp },
        ]}
        closeLabel="观其结果"
        onClose={() => setPhase('result')}
      />
    );
  }

  if (phase === 'result' && result) {
    const survived = !result.tribulation || result.tribulation.winner === 'A';
    return (
      <Modal open={open} onClose={reset} dismissable={false}>
        <div className="bt__result">
          {!survived ? (
            <>
              <span className="bt__verdict bt__verdict--lose">劫</span>
              <p className="muted">天劫未过，气血尽损。养伤再来。</p>
            </>
          ) : result.success ? (
            <>
              <span className="bt__verdict bt__verdict--win">破</span>
              <p>
                {result.fromStageName} → <strong>{result.toStageName}</strong>
              </p>
              <p className="muted">周身经脉一震，天地灵气自四面涌来。</p>
            </>
          ) : (
            <>
              <span className="bt__verdict bt__verdict--lose">阻</span>
              <InkCrack />
              <p>
                功亏一篑，散去修为{' '}
                <strong className="numeral">{Math.round(result.expLost).toLocaleString('zh-CN')}</strong>
              </p>
              <p className="muted">成算 {Math.round(result.chance * 100)}%，天意如此。稳住心神，再来。</p>
            </>
          )}
          <Button variant="primary" block onClick={reset}>
            {result.success ? '收功' : '再修一阵'}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={reset}
      title="运功破境"
      lede={needsTribulation ? '大乘圆满，须先渡天劫，方能问鼎渡劫之境。' : '成则登堂入室，败则散去两成修为。'}
    >
      <div className="bt__odds">
        <div className="bt__chance ink-display">
          {Math.round(chance * 100)}
          <small>%</small>
        </div>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
          成算上限九成五，五分敬畏留与天道
        </p>
      </div>

      <div>
        <span className="field__label">
          服用{pillName}（囊中 {owned} 颗）
        </span>
        <div className="bt__pills">
          {Array.from({ length: MAX_BREAKTHROUGH_PILLS + 1 }, (_, count) => (
            <button
              key={count}
              type="button"
              className={`pill-pick ${pills === count ? 'pill-pick--on' : ''}`}
              disabled={count > maxPills}
              aria-pressed={pills === count}
              onClick={() => setPills(count)}
            >
              {count}
            </button>
          ))}
        </div>
        <p className="field__hint">每颗 +15 个百分点。</p>
      </div>

      <Button
        variant="seal"
        block
        disabled={phase === 'working'}
        onClick={() => void attempt()}
        style={{ marginTop: 'var(--sp-4)' }}
      >
        {phase === 'working' ? '运功中……' : needsTribulation ? '引劫加身' : '起念破境'}
      </Button>
      <Button variant="quiet" block onClick={reset}>
        再等等
      </Button>
    </Modal>
  );
}

/** A split brush stroke, drawn rather than an icon — the failure mark. */
function InkCrack() {
  return (
    <svg className="bt__crack" viewBox="0 0 140 40" fill="none" aria-hidden="true">
      <path
        d="M4 20h44l10-9 8 18 9-16 10 12 8-7h43"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
