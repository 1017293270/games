import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router';
import type { SettleResponse, ZoneLoot } from '@xianxia/shared';
import { SETTLE_INTERVAL_MS } from '../config';
import { ArenaChallengedNotice } from '../features/arena/ArenaChallengedNotice';
import { OfflineReturnModal, receiptAwaySec } from '../features/cultivation/OfflineReturnModal';
import { useCharacterStore } from '../store/character';
import { useSessionStore } from '../store/session';
import { closeSocket, openSocket } from '../store/socket';
import { useZoneStore } from '../store/zone';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';

/** Time away that is worth interrupting the player with a summary. */
const RETURN_THRESHOLD_SEC = 120;

/**
 * Whether a 战果 receipt is proof the character fought on without its owner.
 *
 * Two things have to hold. The window it covers has to be longer than the
 * threshold — the same one the 修炼 summary uses — and it has to have opened
 * before this session did: `store/zone.ts` merges every receipt into one tally
 * and keeps the *earliest* `since`, so a stint that began after the app opened
 * is this session's own farming, however old that `since` looks by now.
 */
function isHomecoming(loot: ZoneLoot | null, sessionAgeMs: number): boolean {
  const awaySec = receiptAwaySec(loot);
  return awaySec >= RETURN_THRESHOLD_SEC && awaySec * 1000 >= sessionAgeMs;
}

export function AppShell() {
  const status = useSessionStore((state) => state.status);
  const token = useSessionStore((state) => state.token);
  const characterId = useSessionStore((state) => state.user?.characterId ?? null);
  const load = useCharacterStore((state) => state.load);
  const settle = useCharacterStore((state) => state.settle);
  const view = useCharacterStore((state) => state.view);
  const loot = useZoneStore((state) => state.loot);
  const [summary, setSummary] = useState<SettleResponse | null>(null);
  /** Whether the 闭关归来 panel has already been offered this session. */
  const greeted = useRef(false);
  /** The boot settle, held so a receipt that lands after it has numbers to show. */
  const settled = useRef<SettleResponse | null>(null);
  /**
   * When this shell mounted. The login screen is a route of its own, so a
   * session that starts with a password lands on a shell mounted right then.
   */
  const openedAt = useRef(Date.now());

  const resettle = useCallback(async () => {
    await settle({ silent: true });
  }, [settle]);

  /** Opens 闭关归来 once, for whichever proof of an absence arrives first. */
  const greet = useCallback((result: SettleResponse) => {
    if (greeted.current) return;
    greeted.current = true;
    setSummary(result);
  }, []);

  /**
   * Boot through `character/settle` rather than `character/get`: reading the
   * character already settles it server-side, so asking for the summary
   * afterwards would always report an empty window and the 闭关归来 panel would
   * never appear. `SettleResponse` carries the full view, so one call is enough.
   */
  const boot = useCallback(async () => {
    const result = await settle({ silent: true });
    if (!result) {
      await load();
      return;
    }
    settled.current = result;
    if (result.creditedSec >= RETURN_THRESHOLD_SEC) {
      greet(result);
      return;
    }
    // The 留场 receipt can beat this settle home: the socket asks the server to
    // restore the field the moment it opens and the tally follows `zone:joined`
    // in the same breath. Whichever of the two arrives second does the greeting.
    if (isHomecoming(useZoneStore.getState().loot, Date.now() - openedAt.current)) greet(result);
  }, [settle, load, greet]);

  useEffect(() => {
    if (status !== 'ready' || !characterId) return;
    void boot();
  }, [status, characterId, boot]);

  /**
   * 留场 spoils. A character left on a 战斗大地图 keeps fighting while its owner
   * is away, and the server hands that whole tally over as one `zone:loot` once
   * the field is restored. The 修炼 summary cannot notice such an absence — the
   * zone loop settles the row every few seconds, so `creditedSec` comes back
   * tiny for exactly the players who were gone longest — so the receipt opens
   * the panel itself, and the panel reads the tally straight from the store.
   */
  useEffect(() => {
    if (greeted.current || !loot) return;
    // No summary yet: the boot settle re-reads the tally when it lands.
    const result = settled.current;
    if (!result) return;
    if (isHomecoming(loot, Date.now() - openedAt.current)) greet(result);
  }, [loot, greet]);

  useEffect(() => {
    if (status !== 'ready' || !token) return;
    openSocket(token);
    return () => closeSocket();
  }, [status, token]);

  // Cultivation is settled lazily server-side, so the client only has to ask
  // again on a timer and whenever the tab comes back to the foreground.
  useEffect(() => {
    if (status !== 'ready' || !characterId) return;
    const id = window.setInterval(() => void resettle(), SETTLE_INTERVAL_MS);
    const onWake = () => {
      if (document.visibilityState === 'visible') void resettle();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [status, characterId, resettle]);

  /**
   * A 战斗大地图 pushes four frames a second, which is pure waste against a tab
   * nobody is looking at — and the character does not need watching to keep
   * fighting. So the room is left when the tab goes away and re-entered when it
   * comes back, which also answers with a full frame and resyncs the field.
   */
  useEffect(() => {
    if (status !== 'ready' || !characterId) return;
    const onVisibility = () => {
      const zone = useZoneStore.getState();
      if (document.visibilityState === 'hidden') {
        if (zone.zoneId) zone.leave();
      } else if (zone.zoneId) {
        zone.enter(zone.zoneId);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [status, characterId]);

  if (status === 'anon') return <Navigate to="/login" replace />;
  if (status === 'ready' && !characterId) return <Navigate to="/create" replace />;

  return (
    <div className="shell">
      <TopBar />
      <main className="scene">{view ? <Outlet /> : <div className="empty">推演中……</div>}</main>
      <TabBar />
      <OfflineReturnModal summary={summary} onClose={() => setSummary(null)} />
      {/*
        A 论道 defence can land while the player is anywhere — 修炼, 洞天, 同道 —
        so the report bar hangs off the shell rather than off one page.
      */}
      <ArenaChallengedNotice />
    </div>
  );
}
