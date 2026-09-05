import { create } from 'zustand';
import type {
  ArenaChallengedEvent,
  ArenaChallengeResponse,
  ArenaOpponent,
  ArenaRecord,
  RaidAttackResponse,
  RaidTarget,
  RaidUpdateEvent,
} from '@xianxia/shared';
import { api } from '../api/endpoints';
import { errorMessage } from '../api/http';
import { useCharacterStore } from './character';
import { toast } from './ui';

const RECORD_PAGE_SIZE = 10;

/** Inbound 论道 reports held at once; past this the oldest fall off the bar. */
const MAX_PENDING_CHALLENGES = 20;

/**
 * State behind 秘境论道's two PvP boards. 论道 and 围攻 share a store because
 * they share a screen, a rating and the same live socket traffic — splitting
 * them would mean two loaders racing on one page.
 */
interface ArenaState {
  // ---- 论道
  opponents: ArenaOpponent[];
  rating: number;
  challengesToday: number;
  dailyLimit: number;
  loadingOpponents: boolean;
  opponentsLoaded: boolean;

  records: ArenaRecord[];
  recordsPage: number;
  recordsHasMore: boolean;
  recordsLoading: boolean;
  recordsLoaded: boolean;

  /**
   * Bouts other cultivators came and fought while this one was away from the
   * screen, newest first. They are reports, not decisions — the notice bar
   * shows the latest with a count and the rest stay in 近日战绩.
   */
  challenges: ArenaChallengedEvent[];

  // ---- 围攻
  targets: RaidTarget[];
  loadingTargets: boolean;
  targetsLoaded: boolean;
  /** Name of the bot whose bar moved most recently, for a brief highlight. */
  lastHitBotId: string | null;

  busy: boolean;

  loadOpponents: () => Promise<void>;
  challenge: (targetId: string) => Promise<ArenaChallengeResponse | null>;
  loadRecords: (page?: number) => Promise<void>;
  receiveChallenge: (event: ArenaChallengedEvent) => void;
  dismissChallenges: () => void;

  loadTargets: () => Promise<void>;
  attack: (botId: string, withParty: boolean) => Promise<RaidAttackResponse | null>;
  applyRaidUpdate: (event: RaidUpdateEvent) => void;

  reset: () => void;
}

export const useArenaStore = create<ArenaState>((set, get) => ({
  opponents: [],
  rating: 0,
  challengesToday: 0,
  dailyLimit: 0,
  loadingOpponents: false,
  opponentsLoaded: false,

  records: [],
  recordsPage: 1,
  recordsHasMore: false,
  recordsLoading: false,
  recordsLoaded: false,

  challenges: [],

  targets: [],
  loadingTargets: false,
  targetsLoaded: false,
  lastHitBotId: null,

  busy: false,

  async loadOpponents() {
    if (get().loadingOpponents) return;
    set({ loadingOpponents: true });
    try {
      const result = await api.arenaOpponents();
      set({
        opponents: result.opponents,
        rating: result.rating,
        challengesToday: result.challengesToday,
        dailyLimit: result.dailyLimit,
        loadingOpponents: false,
        opponentsLoaded: true,
      });
    } catch (error) {
      set({ loadingOpponents: false });
      toast(errorMessage(error), 'warn');
    }
  },

  async challenge(targetId) {
    if (get().busy) return null;
    set({ busy: true });
    try {
      const result = await api.arenaChallenge(targetId);
      set((current) => ({
        busy: false,
        rating: result.ratingAfter,
        challengesToday: current.challengesToday + 1,
      }));
      // The battle leaves the challenger wounded and richer; pull the fresh view.
      void useCharacterStore.getState().load();
      return result;
    } catch (error) {
      set({ busy: false });
      toast(errorMessage(error), 'warn');
      return null;
    }
  },

  async loadRecords(page = 1) {
    if (get().recordsLoading) return;
    set({ recordsLoading: true });
    try {
      const result = await api.arenaRecords({ page, pageSize: RECORD_PAGE_SIZE });
      set((current) => ({
        records: page === 1 ? result.items : [...current.records, ...result.items],
        recordsPage: result.page,
        recordsHasMore: result.hasMore,
        recordsLoading: false,
        recordsLoaded: true,
      }));
    } catch (error) {
      set({ recordsLoading: false });
      toast(errorMessage(error), 'warn');
    }
  },

  receiveChallenge(event) {
    set((current) => ({
      challenges: [event, ...current.challenges].slice(0, MAX_PENDING_CHALLENGES),
      rating: current.rating ? current.rating + event.ratingDelta : current.rating,
      recordsLoaded: false,
    }));
  },

  /** One 「知道了」 clears the batch; every bout is still in the record book. */
  dismissChallenges() {
    set({ challenges: [] });
  },

  async loadTargets() {
    if (get().loadingTargets) return;
    set({ loadingTargets: true });
    try {
      const result = await api.raidTargets();
      set({ targets: result.targets, loadingTargets: false, targetsLoaded: true });
    } catch (error) {
      set({ loadingTargets: false });
      toast(errorMessage(error), 'warn');
    }
  },

  async attack(botId, withParty) {
    if (get().busy) return null;
    set({ busy: true });
    try {
      const result = await api.raidAttack({ botId, withParty });
      set((current) => ({
        busy: false,
        targets: current.targets.map((t) => (t.id === botId ? result.target : t)),
      }));
      void useCharacterStore.getState().load();
      return result;
    } catch (error) {
      set({ busy: false });
      toast(errorMessage(error), 'warn');
      return null;
    }
  },

  /** Live blood-pool traffic: other raiders chipping away at the same bots. */
  applyRaidUpdate(event) {
    set((current) => ({
      lastHitBotId: event.botId,
      targets: current.targets.map((target) =>
        target.id === event.botId
          ? { ...target, hpPercent: event.hpPercent, protectedUntil: event.protectedUntil }
          : target,
      ),
    }));
  },

  reset() {
    set({
      opponents: [],
      opponentsLoaded: false,
      records: [],
      recordsLoaded: false,
      challenges: [],
      targets: [],
      targetsLoaded: false,
      lastHitBotId: null,
      busy: false,
    });
  },
}));
