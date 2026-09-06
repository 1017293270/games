import { useEffect, useRef, useState } from 'react';
import type { Application } from 'pixi.js';
import type { ArtId } from '@xianxia/shared';
import { useArtStore } from '../../store/art';
import { useZoneStore, zoneFrames } from '../../store/zone';
import { createZoneScene, type ZoneScene, type ZoneSource } from './renderer/scene';
import type { PixiApi } from './renderer/textures';
import { ZoneList } from './ZoneList';

/**
 * 战斗大地图的 PixiJS 画面。
 *
 * PixiJS 是动态 import 的：它连同渲染器一起被打进独立的 `pixi` chunk，只有真的
 * 走进一张图时才下载，修炼界面一个字节都不用付。初始化失败（没有 WebGL、上下文
 * 被拒）就退回 `ZoneList` 那份 DOM 花名册——这个页面在任何浏览器上都必须是完整
 * 的，画面只是它更好看的一种形态。
 *
 * 逐帧数据不走 React：ticker 直接读 `zoneFrames`，store 只提供名册与自己的槽位。
 * 4 Hz x 一百多个坐标如果穿过 zustand，会把每个订阅者都叫醒一次。
 */
export default function ZoneCanvas() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let app: Application | null = null;
    let scene: ZoneScene | null = null;
    const teardown: (() => void)[] = [];

    const start = async () => {
      let pixi: PixiApi;
      try {
        pixi = await import('pixi.js');
      } catch {
        if (!cancelled) setFailed(true);
        return;
      }
      if (cancelled) return;

      // deviceMemory 只有 Chromium 系有；拿不到就当成正常机器，宁可多画也不要
      // 在好设备上无故降档。
      const nav = navigator as Navigator & { deviceMemory?: number };
      const lowEnd = (nav.deviceMemory ?? 8) <= 2 || (navigator.hardwareConcurrency ?? 8) <= 4;
      const reducedMotion =
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

      const application = new pixi.Application();
      try {
        await application.init({
          preference: 'webgl',
          // 圆球和剪影都是贴图，抗锯齿只是白白多一遍采样。
          antialias: false,
          backgroundAlpha: 0,
          resolution: lowEnd ? 1 : Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
          resizeTo: host,
        });
      } catch {
        if (!cancelled) setFailed(true);
        return;
      }
      if (cancelled) {
        application.destroy(true, { children: true });
        return;
      }
      app = application;

      const canvas = application.canvas;
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      // 画布自己吃掉手势，拖动地图时页面不要跟着滚。
      canvas.style.touchAction = 'none';
      host.appendChild(canvas);

      const read = (): ZoneSource => {
        const state = useZoneStore.getState();
        return {
          frames: zoneFrames,
          roster: state.roster,
          self: state.self,
          zoneId: state.zoneId,
        };
      };

      scene = createZoneScene(pixi, application, {
        lowEnd,
        reducedMotion,
        resolveArt: (id: ArtId) => useArtStore.getState().entry(id)?.src ?? null,
        read,
      });

      // 低端机锁 30 fps：这张图上没有任何东西需要 60 fps 才看得清，省下的是电。
      if (lowEnd) application.ticker.maxFPS = 30;
      application.ticker.add(() => {
        scene?.update(performance.now());
      });

      // manifest 是异步到的，`?art=off` 也可能中途切换：到货就把底图和立绘重挂一遍。
      const unsubscribeArt = useArtStore.subscribe((state, previous) => {
        if (state.manifest !== previous.manifest || state.enabled !== previous.enabled) {
          scene?.refreshArt();
        }
      });
      teardown.push(unsubscribeArt);

      const onVisibility = () => {
        if (document.hidden) application.ticker.stop();
        else application.ticker.start();
      };
      document.addEventListener('visibilitychange', onVisibility);
      teardown.push(() => document.removeEventListener('visibilitychange', onVisibility));

      // 拖动看别处，停手三秒自动回到自己身上（`camera.isFollowing`）。
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      const onDown = (event: PointerEvent) => {
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        canvas.setPointerCapture?.(event.pointerId);
      };
      const onMove = (event: PointerEvent) => {
        if (!dragging) return;
        scene?.pan(event.clientX - lastX, event.clientY - lastY, performance.now());
        lastX = event.clientX;
        lastY = event.clientY;
      };
      const onUp = (event: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        canvas.releasePointerCapture?.(event.pointerId);
        scene?.endPan(performance.now());
      };
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      teardown.push(() => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
      });
    };

    void start();

    return () => {
      cancelled = true;
      for (const off of teardown) off();
      scene?.destroy();
      scene = null;
      // 纹理、几何、WebGL 上下文一并释放：来回进出四张图不该攒下四个上下文。
      app?.destroy(true, { children: true });
      app = null;
    };
  }, []);

  if (failed) {
    return (
      <div className="zone-plain">
        <ZoneList />
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="zone-canvas"
      role="img"
      aria-label="战斗大地图：修士与妖兽在图上自动交战"
    />
  );
}
