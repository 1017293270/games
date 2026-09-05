import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUiStore } from '../store/ui';

/**
 * Modals, sheets and toasts render into a layer pinned to the ink frame rather
 * than to the document, so on desktop they stay inside the painted page
 * instead of floating over the whole browser window.
 */
const OverlayContext = createContext<HTMLElement | null>(null);

export const OverlayProvider = OverlayContext.Provider;

export function useOverlayRoot(): HTMLElement | null {
  return useContext(OverlayContext);
}

export interface OverlayProps {
  children: ReactNode;
  /**
   * Whether this layer counts towards `overlayDepth`, the store's tally of what
   * is currently covering the page. `false` for a layer that reports rather
   * than interrupts — it must not hold back the notices waiting on that tally.
   */
  blocking?: boolean;
}

export function Overlay({ children, blocking = true }: OverlayProps) {
  const root = useOverlayRoot();

  useEffect(() => {
    if (!blocking) return;
    const { openOverlay, closeOverlay } = useUiStore.getState();
    openOverlay();
    return closeOverlay;
  }, [blocking]);

  if (!root) return <>{children}</>;
  return createPortal(children, root);
}
