import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { stageName, type MapListEntry } from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { ArtImage } from '../../art/ArtImage';
import { CloudRule } from '../../design';
import { toast } from '../../store/ui';
import { canUseZoneCanvas, useZoneStore } from '../../store/zone';
import { ZoneHud } from './ZoneHud';
import { ZoneList } from './ZoneList';
import '../explore/explore.css';
import './zone.css';

/**
 * The PixiJS field, and everything it drags in, is fetched only once a player
 * actually walks onto a map — the 修炼 screen must not pay for it.
 */
const ZoneCanvas = lazy(async () => ({ default: (await import('./ZoneCanvas')).default }));

/**
 * 山河图 — the map list, and the 战斗大地图 you stand on once you pick one.
 *
 * One route with three faces: out of a zone it is the list of places the
 * character's 境界 opens up; joining is a held breath; inside, the field fills
 * the screen with the HUD over it. Where the canvas cannot run — no WebGL,
 * reduced motion, jsdom — the roster takes its place and the page still works.
 */
export function ZonePage() {
  const status = useZoneStore((state) => state.status);
  const enter = useZoneStore((state) => state.enter);
  const [maps, setMaps] = useState<MapListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const painted = useMemo(canUseZoneCanvas, []);

  const reload = useCallback(async () => {
    try {
      const response = await api.exploreMaps();
      setMaps(response.maps);
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'out') return;
    void reload();
  }, [status, reload]);

  if (status === 'joining') {
    return (
      <div className="zone-wait">
        <p className="empty">正在入山……</p>
      </div>
    );
  }

  if (status === 'in') {
    return (
      <div className="zone-scene">
        {painted ? (
          <Suspense fallback={<div className="zone-canvas zone-canvas--wait" />}>
            <ZoneCanvas />
          </Suspense>
        ) : (
          <div className="zone-plain">
            <ZoneList />
          </div>
        )}
        <ZoneHud />
      </div>
    );
  }

  return (
    <div>
      <header className="page-head">
        <h1 className="page-head__title">山河图</h1>
        <p className="page-head__note">择一处落脚，人妖同场，走开也照打。</p>
      </header>
      <CloudRule />

      <Link to="/town" className="town-entry">
        <span className="town-entry__seal" aria-hidden="true">
          镇
        </span>
        <span className="town-entry__body">
          <span className="town-entry__name">青云镇</span>
          <span className="town-entry__note">八位镇民在此。领任务、买丹药、听消息。</span>
        </span>
      </Link>

      <div className="maps">
        {maps.map((map) => (
          <button
            key={map.id}
            type="button"
            className={`map-card ${map.unlocked ? '' : 'map-card--locked'}`}
            disabled={!map.unlocked}
            onClick={() => enter(map.id)}
          >
            <div className="map-card__art">
              <ArtImage id={map.art} label={map.name} motif="scene" small />
            </div>
            <div className="map-card__body">
              <h2 className="map-card__name">{map.name}</h2>
              <p className="map-card__desc">{map.description}</p>
              <div className="map-card__meta">
                {map.unlocked ? (
                  <>
                    <span>宜 {stageName(map.recommendedStage)}</span>
                    <span>{map.monsters.map((m) => m.name).join(' · ')}</span>
                    <span className="map-card__go">入场</span>
                  </>
                ) : (
                  <span className="map-card__lock">需 {stageName(map.unlockStage)}</span>
                )}
              </div>
            </div>
          </button>
        ))}
        {maps.length === 0 && (
          <p className="empty">{loading ? '正在展开山河图……' : '无处可去。'}</p>
        )}
      </div>
    </div>
  );
}
