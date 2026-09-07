import { formatDuration, type SettleResponse, type ZoneLoot } from '@xianxia/shared';
import { Button, CloudRule, Modal } from '../../design';
import { serverNow } from '../../store/session';
import { useZoneStore } from '../../store/zone';
import './cultivation.css';

export interface OfflineReturnModalProps {
  summary: SettleResponse | null;
  onClose: () => void;
}

/**
 * Seconds a 战果 receipt says the character has been banking spoils for.
 *
 * `since` is the server's epoch ms for the moment the accrual window opened —
 * for a 留场 character, the moment its owner dropped off the socket — so the
 * clock offset measured at login is applied before subtracting.
 */
export function receiptAwaySec(loot: ZoneLoot | null): number {
  if (!loot) return 0;
  return Math.max(0, (serverNow() - loot.since) / 1000);
}

/** The 闭关归来 summary: what the wall clock was worth while you were away. */
export function OfflineReturnModal({ summary, onClose }: OfflineReturnModalProps) {
  // Whatever the character banked on a 战斗大地图 while the tab was shut. The
  // socket asks the server to restore the field as soon as it opens, so the
  // 挂机 tally is usually here by the time this panel is.
  const loot = useZoneStore((state) => state.loot);
  const zoneId = useZoneStore((state) => state.zoneId);
  if (!summary) return null;
  const forfeited = summary.forfeitedSec > 1;
  const fought = Boolean(loot && (loot.kills > 0 || loot.exp > 0));
  // 修炼 is settled every few seconds for anyone left on a 战斗大地图, so
  // `elapsedSec` under-reports the absence of exactly the players who were away
  // longest. The receipt's own window is the longer, truer measure of it.
  const awaySec = Math.max(summary.elapsedSec, receiptAwaySec(loot));

  return (
    <Modal
      open
      onClose={onClose}
      title="闭关归来"
      lede={`离山 ${formatDuration(awaySec)}，坐忘而已`}
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

      {fought && loot && (
        <>
          <CloudRule />
          <h3 className="settle-sub">挂机战果</h3>
          <div className="settle-rows">
            <div className="settle-row">
              <span className="settle-row__k">斩妖</span>
              <span className="settle-row__v numeral">
                {loot.kills.toLocaleString('zh-CN')}
                {loot.bossKills > 0 ? ` （秘境 ${loot.bossKills}）` : ''}
              </span>
            </div>
            <div className="settle-row">
              <span className="settle-row__k">场中所得</span>
              <span className="settle-row__v settle-row__v--gain numeral">
                修为 +{loot.exp.toLocaleString('zh-CN')} · 灵石 +
                {loot.spiritStones.toLocaleString('zh-CN')}
              </span>
            </div>
            {loot.items.length > 0 && (
              <div className="settle-row">
                <span className="settle-row__k">拾得</span>
                <span className="settle-row__v">
                  {loot.items
                    .map((item) => `${item.name}${item.qty > 1 ? `×${item.qty}` : ''}`)
                    .join(' · ')}
                </span>
              </div>
            )}
            {zoneId && (
              <div className="settle-row">
                <span className="settle-row__k">仍在场</span>
                <span className="settle-row__v muted">尚未撤离，还在替你打</span>
              </div>
            )}
          </div>
        </>
      )}

      <CloudRule />
      <p
        className="muted"
        style={{ fontSize: 'var(--fs-sm)', textAlign: 'center', margin: 'var(--sp-3) 0' }}
      >
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
