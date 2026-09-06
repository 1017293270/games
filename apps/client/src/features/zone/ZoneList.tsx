import { stageName, ZONE_FLAGS, type ZoneRosterEntry } from '@xianxia/shared';
import { ProgressBar } from '../../design';
import { useZoneStore, zoneFrames } from '../../store/zone';
import './zone.css';

/**
 * The 战斗大地图 as a roster rather than a field.
 *
 * Stands in for the canvas wherever one cannot or should not run — no WebGL,
 * `prefers-reduced-motion`, jsdom under test — and it is not a degraded mode:
 * everything the renderer draws is here in words, so the same fight can be
 * followed line by line. It reads `zoneFrames` directly and re-renders off
 * `lastSeq`, which ticks once per frame.
 */

const KIND_LABEL: Record<ZoneRosterEntry['kind'], string> = {
  player: '道友',
  bot: '散修',
  monster: '妖兽',
  boss: '秘境',
};

/** Reading order: you, then the cultivators you might meet, then the field. */
const KIND_RANK: Record<ZoneRosterEntry['kind'], number> = {
  boss: 1,
  player: 2,
  bot: 3,
  monster: 4,
};

/** Steady flags first, then the one-shot pulses that show the blow landing. */
function tagsOf(flags: number): string[] {
  const tags: string[] = [];
  if (flags & ZONE_FLAGS.DEAD) tags.push('已倒');
  if (flags & ZONE_FLAGS.PROTECTED) tags.push('护身');
  if (flags & ZONE_FLAGS.OFFLINE) tags.push('挂机');
  if (flags & ZONE_FLAGS.CASTING) tags.push('施法');
  if (flags & ZONE_FLAGS.CRIT) tags.push('暴击');
  else if (flags & ZONE_FLAGS.HIT) tags.push('出手');
  if (flags & ZONE_FLAGS.DODGED) tags.push('闪避');
  if (flags & ZONE_FLAGS.MOVING) tags.push('疾行');
  return tags;
}

export function ZoneList() {
  const roster = useZoneStore((state) => state.roster);
  const self = useZoneStore((state) => state.self);
  // Poses live outside the store, so the frame counter is what says "redraw".
  const seq = useZoneStore((state) => state.lastSeq);

  const rows = Object.values(roster).sort((a, b) => {
    if (a.i === self) return -1;
    if (b.i === self) return 1;
    const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (rank !== 0) return rank;
    if (a.stageIndex !== b.stageIndex) return b.stageIndex - a.stageIndex;
    return a.i - b.i;
  });

  if (rows.length === 0) return <p className="empty">此地空无一人。</p>;

  return (
    <ul className="zone-roster" data-seq={seq}>
      {rows.map((entry) => {
        const track = zoneFrames.get(entry.i);
        const hp = track?.next.hp ?? entry.maxHp;
        const flags = track?.next.flags ?? 0;
        const target = track && track.targetI >= 0 ? roster[track.targetI] : undefined;
        const isSelf = entry.i === self;
        const dead = Boolean(flags & ZONE_FLAGS.DEAD);

        return (
          <li
            key={entry.i}
            className={[
              'zone-row',
              isSelf ? 'zone-row--self' : '',
              dead ? 'zone-row--dead' : '',
              entry.kind === 'boss' ? 'zone-row--boss' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="zone-row__head">
              <span className="zone-row__name">
                {isSelf && <span className="zone-row__you">你</span>}
                {entry.name}
              </span>
              <span className="zone-row__stage">
                {KIND_LABEL[entry.kind]} · {stageName(entry.stageIndex)}
              </span>
            </div>

            <ProgressBar
              value={entry.maxHp > 0 ? hp / entry.maxHp : 0}
              tone={entry.kind === 'boss' ? 'gold' : dead ? 'ink' : 'cinnabar'}
              thin
              label={`${entry.name} 气血`}
            />

            <div className="zone-row__meta">
              <span className="numeral">
                {Math.max(0, hp).toLocaleString('zh-CN')} / {entry.maxHp.toLocaleString('zh-CN')}
              </span>
              <span className="zone-row__target">
                {dead ? '待复生' : target ? `战 ${target.name}` : '游荡'}
              </span>
              {tagsOf(flags).map((tag) => (
                <span className="zone-tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
