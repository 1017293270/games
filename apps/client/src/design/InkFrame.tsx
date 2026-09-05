import { useState, type ReactNode } from 'react';
import { OverlayProvider } from './Overlay';

/**
 * The painted page. On a phone it fills the viewport; on a desktop it becomes a
 * fixed-width album leaf floating on a wash, with cut corner marks. Overlays
 * are hosted inside it so nothing escapes the leaf.
 */
export function InkFrame({ children }: { children: ReactNode }) {
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null);

  return (
    <div className="frame-stage">
      <div className="frame">
        <span className="frame__corner frame__corner--tl" />
        <span className="frame__corner frame__corner--tr" />
        <span className="frame__corner frame__corner--bl" />
        <span className="frame__corner frame__corner--br" />
        <OverlayProvider value={overlayRoot}>{children}</OverlayProvider>
        <div className="overlay-root" ref={setOverlayRoot} />
      </div>
    </div>
  );
}
