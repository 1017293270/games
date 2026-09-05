import { useNavigate } from 'react-router';
import { ArtImage } from '../art/ArtImage';
import { ProgressBar, StoneMark } from '../design';
import { useLiveCultivation } from '../features/cultivation/useLiveCultivation';
import { useCharacterStore } from '../store/character';
import { useUiStore } from '../store/ui';

export function TopBar() {
  const view = useCharacterStore((state) => state.view);
  const onlineCount = useUiStore((state) => state.onlineCount);
  const live = useLiveCultivation();
  const navigate = useNavigate();

  if (!view) return null;
  const { character, stageName } = view;

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar__avatar"
        onClick={() => navigate('/character')}
        aria-label="查看角色"
      >
        <ArtImage id={character.avatarArt} label="" motif="portrait" />
      </button>

      <div className="topbar__id">
        <div className="topbar__line">
          <span className="topbar__name">{character.name}</span>
          <span className="topbar__stage ink-display">{stageName}</span>
        </div>
        <div className="topbar__meter">
          <ProgressBar
            value={live.progress}
            tone={live.atPerfection ? 'gold' : 'ink'}
            thin
            label="修为"
          />
          <span className="topbar__pct numeral">
            {live.atPerfection ? '圆满' : `${Math.floor(live.progress * 100)}%`}
          </span>
        </div>
      </div>

      <div className="topbar__stones">
        <span className="topbar__stone-count numeral">
          <StoneMark />
          {character.spiritStones.toLocaleString('zh-CN')}
        </span>
        <span className="topbar__online numeral">在线 {onlineCount || 1}</span>
      </div>
    </header>
  );
}
