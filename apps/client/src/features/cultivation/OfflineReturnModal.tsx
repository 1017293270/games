import { formatDuration, type SettleResponse } from '@xianxia/shared';
import { Button, CloudRule, Modal } from '../../design';
import './cultivation.css';

export interface OfflineReturnModalProps {
  summary: SettleResponse | null;
  onClose: () => void;
}

/** The 闭关归来 summary: what the wall clock was worth while you were away. */
export function OfflineReturnModal({ summary, onClose }: OfflineReturnModalProps) {
  if (!summary) return null;
  const forfeited = summary.forfeitedSec > 1;

  return (
    <Modal
      open
      onClose={onClose}
      title="闭关归来"
      lede={`离山 ${formatDuration(summary.elapsedSec)}，坐忘而已`}
    >
      <div className="settle-rows">
        <div className="settle-row">
          <span className="settle-row__k">入账修为</span>
          <span className="settle-row__v settle-row__v--gain numeral">
            +{Math.round(summary.gainedExp).toLocaleString('zh-CN')}
          </span>
        </div>
        <div className="settle-row">
          <span className="settle-row__k">计入时长</span>
          <span className="settle-row__v numeral">{formatDuration(summary.creditedSec)}</span>
        </div>
        {forfeited && (
          <div className="settle-row">
            <span className="settle-row__k">逾期作废</span>
            <span className="settle-row__v numeral muted">
              {formatDuration(summary.forfeitedSec)}
            </span>
          </div>
        )}
        {summary.stageUps > 0 && (
          <div className="settle-row">
            <span className="settle-row__k">连破</span>
            <span className="settle-row__v">{summary.stagesPassed.join(' · ')}</span>
          </div>
        )}
      </div>

      <CloudRule />
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', textAlign: 'center', margin: 'var(--sp-3) 0' }}>
        {summary.stageUps > 0
          ? '闭关一场，小境已过。'
          : forfeited
            ? '离山太久，逾十二时辰的部分散入天地了。'
            : '静水流深，进境稳当。'}
      </p>

      <Button variant="primary" block onClick={onClose}>
        继续修行
      </Button>
    </Modal>
  );
}
