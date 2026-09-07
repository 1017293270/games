import { create } from 'zustand';
import {
  ProgressionDrawRequestSchema,
  type GachaHistoryEntry,
  type ProgressionDrawRequest,
  type ProgressionResponse,
} from '@xianxia/shared';
import { api } from '../api/endpoints';
import { ApiError, errorMessage } from '../api/http';
import { useCharacterStore } from './character';
import { useSessionStore } from './session';

let generation = 0;
export function progressionRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, '0'),
  ).join('');
}

function pendingKey(): string | null {
  const id = useCharacterStore.getState().view?.character.id;
  return id ? `qingyun-pending-draw:${id}` : null;
}
function savePending(request: ProgressionDrawRequest | null): void {
  const key = pendingKey();
  if (!key) return;
  try {
    if (request) sessionStorage.setItem(key, JSON.stringify(request));
    else sessionStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable; the current page still retains its receipt. */
  }
}
function restorePending(): ProgressionDrawRequest | null {
  const key = pendingKey();
  if (!key) return null;
  try {
    const parsed = ProgressionDrawRequestSchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) ?? 'null'),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface ProgressionStore {
  busy: boolean;
  error: string | null;
  history: GachaHistoryEntry[];
  pendingDraw: ProgressionDrawRequest | null;
  run: (job: () => Promise<ProgressionResponse>) => Promise<ProgressionResponse | null>;
  load: () => Promise<ProgressionResponse | null>;
  draw: (input: Omit<ProgressionDrawRequest, 'requestId'>) => Promise<ProgressionResponse | null>;
  retryDraw: () => Promise<ProgressionResponse | null>;
  loadHistory: () => Promise<void>;
  reset: () => void;
}

export const useProgressionStore = create<ProgressionStore>((set, get) => ({
  busy: false,
  error: null,
  history: [],
  pendingDraw: null,
  reset() {
    generation++;
    set({ busy: false, error: null, history: [], pendingDraw: null });
  },
  async run(job) {
    if (get().busy) return null;
    const started = generation;
    const characterId = useCharacterStore.getState().view?.character.id;
    set({ busy: true, error: null });
    try {
      const response = await job();
      if (started !== generation || characterId !== useCharacterStore.getState().view?.character.id)
        return null;
      useCharacterStore.getState().setView(response.view);
      return response;
    } catch (error) {
      if (started === generation) set({ error: errorMessage(error) });
      return null;
    } finally {
      if (started === generation) set({ busy: false });
    }
  },
  load: () => {
    set({ pendingDraw: restorePending() });
    return get().run(api.progression);
  },
  async draw(input) {
    if (get().busy || get().pendingDraw) return null;
    const request = { ...input, requestId: progressionRequestId() };
    savePending(request);
    set({ pendingDraw: request });
    return get().retryDraw();
  },
  async retryDraw() {
    const request = get().pendingDraw;
    if (!request) return null;
    const started = generation;
    return get().run(async () => {
      try {
        const result = await api.progressionDraw(request);
        if (started === generation) {
          savePending(null);
          set({ pendingDraw: null });
        }
        return result;
      } catch (error) {
        // An uncertain response must reuse the same request, including after changing pools.
        if (
          started === generation &&
          error instanceof ApiError &&
          error.code !== 'INTERNAL_ERROR' &&
          error.code !== 'VALIDATION_ERROR'
        ) {
          savePending(null);
          set({ pendingDraw: null });
        }
        throw error;
      }
    });
  },
  async loadHistory() {
    const started = generation;
    try {
      const result = await api.progressionHistory();
      if (started === generation) set({ history: result.items });
    } catch (error) {
      if (started === generation) set({ error: errorMessage(error) });
    }
  },
}));

useSessionStore.subscribe((next, previous) => {
  if (next.token !== previous.token) useProgressionStore.getState().reset();
});
useCharacterStore.subscribe((next, previous) => {
  if (previous.view && next.view?.character.id !== previous.view.character.id)
    useProgressionStore.getState().reset();
});
