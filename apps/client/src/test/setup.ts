import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { installMock } from '../api/mock';

// `globals: false` means Testing Library cannot register its own auto-cleanup,
// so the unmount between tests is wired up explicitly.
afterEach(() => {
  cleanup();
});

// jsdom has no media query engine; the components only ever read `matches`.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// Every test runs against the same in-memory world the `VITE_MOCK=1` build uses.
installMock();
