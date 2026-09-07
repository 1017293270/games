import { installPlayerTheme } from './playerTheme';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { InkFrame, ToastHost } from '../design';
import { ProfileDrawer } from '../features/profile/ProfileDrawer';
import { useArtStore } from '../store/art';
import { useSessionStore } from '../store/session';
import { router } from './routes';
import { BootSplash } from './BootSplash';

export function App() {
  useEffect(() => installPlayerTheme(router), []);
  const status = useSessionStore((state) => state.status);
  const restore = useSessionStore((state) => state.restore);
  const loadArt = useArtStore((state) => state.load);

  useEffect(() => {
    void restore();
    void loadArt();
  }, [restore, loadArt]);

  return (
    <InkFrame>
      {status === 'boot' ? <BootSplash /> : <RouterProvider router={router} />}
      <ToastHost />
      <ProfileDrawer />
    </InkFrame>
  );
}
