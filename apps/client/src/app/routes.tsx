import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '../shell/AppShell';
import { LoginPage } from '../features/auth/LoginPage';
import { CreateCharacterPage } from '../features/auth/CreateCharacterPage';
import { CultivationPage } from '../features/cultivation/CultivationPage';
import { ExplorePage } from '../features/explore/ExplorePage';
import { RealmPage } from '../features/realm/RealmPage';
import { SocialPage } from '../features/social/SocialPage';
import { CharacterPage } from '../features/character/CharacterPage';

const AdminPage = lazy(() => import('../admin'));

/** Every route in the game lives here, one line each. */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/create', element: <CreateCharacterPage /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <CultivationPage /> },
      { path: 'explore', element: <ExplorePage /> },
      { path: 'realm', element: <RealmPage /> },
      { path: 'social', element: <SocialPage /> },
      { path: 'character', element: <CharacterPage /> },
    ],
  },
  {
    path: '/admin',
    element: (
      <Suspense fallback={<div className="empty">载入中……</div>}>
        <AdminPage />
      </Suspense>
    ),
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
