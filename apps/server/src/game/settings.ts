import {
  applyWorldSettingsPatch,
  hydrateWorldSettings,
  type WorldSettings,
  type WorldSettingsPatch,
} from '@xianxia/shared';
import type { SettingsRepo } from '../db/repo/misc.js';

/** The `settings` row the world config lives in. */
export const WORLD_SETTINGS_KEY = 'world';

/**
 * In-process cache of the world settings.
 *
 * Every formula reads this on the hot path, so it is held in memory and
 * refreshed only when the admin panel writes. `PUT /api/admin/settings` goes
 * through `patch()`, which persists and swaps the cached object in one step, so
 * the very next request — and the next bot tick — sees the new value.
 */
export class SettingsStore {
  private current: WorldSettings;
  private listeners = new Set<(next: WorldSettings) => void>();

  constructor(
    private readonly repo: SettingsRepo,
    private readonly now: () => number,
  ) {
    this.current = hydrateWorldSettings(this.repo.get(WORLD_SETTINGS_KEY));
  }

  /** The live settings. Callers must not mutate the returned object. */
  get(): WorldSettings {
    return this.current;
  }

  /** Applies a validated partial update, persists it and notifies listeners. */
  patch(patch: WorldSettingsPatch): WorldSettings {
    const next = applyWorldSettingsPatch(this.current, patch);
    this.repo.put(WORLD_SETTINGS_KEY, next, this.now());
    this.current = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }

  /** Re-reads from storage; used after an out-of-band write. */
  reload(): WorldSettings {
    this.current = hydrateWorldSettings(this.repo.get(WORLD_SETTINGS_KEY));
    return this.current;
  }

  /** Called after every successful `patch`; the bot engine re-times its loop. */
  onChange(listener: (next: WorldSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
