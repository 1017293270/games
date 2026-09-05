import type { ArtId, ArtManifestEntry } from '@xianxia/shared';
import { useArtStore } from '../store/art';

/**
 * Resolves a bitmap ID against the manifest.
 *
 * Returns `null` whenever the manifest has not loaded, the ID is absent, or the
 * `?art=off` switch is on — callers must always be able to render without it.
 */
export function useArt(id: ArtId | null | undefined): ArtManifestEntry | null {
  const manifest = useArtStore((state) => state.manifest);
  const enabled = useArtStore((state) => state.enabled);
  if (!id || !enabled || !manifest) return null;
  return manifest.assets[id] ?? null;
}
