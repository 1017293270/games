import { create } from 'zustand';
import { isArtId, type ArtId, type ArtManifest, type ArtManifestEntry } from '@xianxia/shared';
import { ART_MANIFEST_URL } from '../config';

/**
 * The bitmap manifest is optional by design: the art pipeline runs on its own
 * schedule, and every component that asks for a picture must already be able to
 * draw itself without one.
 */
interface ArtState {
  manifest: ArtManifest | null;
  status: 'idle' | 'loading' | 'ready' | 'absent';
  /** `?art=off` turns bitmaps off so placeholders can be compared side by side. */
  enabled: boolean;
  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  entry: (id: ArtId) => ArtManifestEntry | null;
}

function initialEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('art') === 'off') {
      sessionStorage.setItem('xianxia.art', 'off');
      return false;
    }
    if (params.get('art') === 'on') {
      sessionStorage.removeItem('xianxia.art');
      return true;
    }
    return sessionStorage.getItem('xianxia.art') !== 'off';
  } catch {
    return true;
  }
}

export const useArtStore = create<ArtState>((set, get) => ({
  manifest: null,
  status: 'idle',
  enabled: initialEnabled(),

  async load() {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    try {
      const response = await fetch(ART_MANIFEST_URL, { cache: 'no-cache' });
      if (!response.ok) {
        set({ status: 'absent' });
        return;
      }
      const manifest = (await response.json()) as ArtManifest;
      set({ manifest, status: 'ready' });
    } catch {
      // No manifest yet is the normal state until the art pipeline has run.
      set({ status: 'absent' });
    }
  },

  setEnabled(enabled) {
    try {
      if (enabled) sessionStorage.removeItem('xianxia.art');
      else sessionStorage.setItem('xianxia.art', 'off');
    } catch {
      // Session storage is a convenience here, not a requirement.
    }
    set({ enabled });
  },

  entry(id) {
    const state = get();
    if (!state.enabled || !state.manifest) return null;
    if (!isArtId(id)) return null;
    return state.manifest.assets[id] ?? null;
  },
}));
