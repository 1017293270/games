import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router';
import type { SettleResponse } from '@xianxia/shared';
import { SETTLE_INTERVAL_MS } from '../config';
import { ArenaChallengedNotice } from '../features/arena/ArenaChallengedNotice';
import { OfflineReturnModal } from '../features/cultivation/OfflineReturnModal';
import { useCharacterStore } from '../store/character';
import { useSessionStore } from '../store/session';
import { closeSocket, openSocket } from '../store/socket';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';

/** Time away that is worth interrupting the player with a summary. */
const RETURN_THRESHOLD_SEC = 120;

export function AppShell() {
  const status = useSessionStore((state) => state.status);
  const token = useSessionStore((state) => state.token);
  const characterId = useSessionStore((state) => state.user?.characterId ?? null);
  const load = useCharacterStore((state) => state.load);
  const settle = useCharacterStore((state) => state.settle);
  const view = useCharacterStore((state) => state.view);
  const [summary, setSummary] = useState<SettleResponse | null>(null);
  const greeted = useRef(false);

  const resettle = useCallback(async () => {
    await settle({ silent: true });
  }, [settle]);

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
    if (greeted.current) return;
    greeted.current = true;
    if (result.creditedSec >= RETURN_THRESHOLD_SEC) setSummary(result);
  }, [settle, load]);

  useEffect(() => {
    if (status !== 'ready' || !characterId) return;
    void boot();
  }, [status, characterId, boot]);

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
