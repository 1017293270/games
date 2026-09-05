import { useEffect } from 'react';
import type { RankingBoard, RankingEntry } from '@xianxia/shared';
import { ArtImage } from '../../art/ArtImage';
import { Button } from '../../design';
import { useRankingsStore } from '../../store/rankings';
import { useUiStore } from '../../store/ui';
import '../social/social.css';

const BOARDS: { id: RankingBoard; label: string; note: string }[] = [
  { id: 'realm', label: '境界', note: '按境界与修为排名' },
  { id: 'power', label: '战力', note: '装备与功法都算在内' },
  { id: 'arena', label: '天梯', note: '论道胜负积分' },
];

function valueOf(board: RankingBoard, entry: RankingEntry): string {
  if (board === 'power') return entry.powerScore.toLocaleString('zh-CN');
  if (board === 'arena') return String(entry.arenaRating);
  return entry.stageName;
}

export function RankingsPanel() {
  const board = useRankingsStore((state) => state.board);
  const entries = useRankingsStore((state) => state.entries);
  const total = useRankingsStore((state) => state.total);
  const page = useRankingsStore((state) => state.page);
  const hasMore = useRankingsStore((state) => state.hasMore);
  const loading = useRankingsStore((state) => state.loading);
  const setBoard = useRankingsStore((state) => state.setBoard);
  const load = useRankingsStore((state) => state.load);
  const openProfile = useUiStore((state) => state.openProfile);

  useEffect(() => {
    if (entries.length === 0) void load(1);
  }, [entries.length, load]);

  const current = BOARDS.find((b) => b.id === board);

  return (
    <div>
      <div className="board-tabs" role="tablist" aria-label="榜单">
        {BOARDS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={board === entry.id}
            className="board-tab"
            onClick={() => void setBoard(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="field__hint" style={{ padding: '0 var(--sp-4) var(--sp-3)' }}>
        {current?.note} · 共 {total.toLocaleString('zh-CN')} 位修士在册
      </p>

      <div className="ranks">
        {entries.map((entry) => (
          <button
            key={entry.characterId}
            type="button"
            className="rank-row"
            onClick={() => openProfile(entry.characterId)}
          >
            <span
              className={`rank-row__n numeral ${entry.rank <= 3 ? `rank-row__n--${entry.rank}` : ''}`}
            >
              {entry.rank}
            </span>
            <span className="rank-row__art">
              <ArtImage id={entry.avatarArt} label="" motif="portrait" />
            </span>
            <span className="rank-row__body">
              <span className="rank-row__name">
                {entry.online && <span className="online-dot" aria-label="在线" />}
                {entry.name}
                {entry.isBot && <span className="puppet">傀儡</span>}
              </span>
              <span className="rank-row__sub">
                {board === 'realm' ? `战力 ${entry.powerScore.toLocaleString('zh-CN')}` : entry.stageName}
              </span>
            </span>
            <span className="rank-row__v numeral">{valueOf(board, entry)}</span>
          </button>
        ))}

        {entries.length === 0 && !loading && <p className="empty">榜单还未张贴。</p>}

        {hasMore && (
          <Button
            variant="quiet"
            block
            disabled={loading}
            style={{ marginTop: 'var(--sp-3)' }}
            onClick={() => void load(page + 1)}
          >
            {loading ? '翻页中……' : '再看一页'}
          </Button>
        )}
      </div>
    </div>
  );
}
