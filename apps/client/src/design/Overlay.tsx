import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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

export function Overlay({ children }: { children: ReactNode }) {
  const root = useOverlayRoot();
  if (!root) return <>{children}</>;
  return createPortal(children, root);
}
