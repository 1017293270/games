import { expect, it } from 'vitest';
import { installPlayerTheme } from './playerTheme';

it('scopes player colors to player routes and restores the original document on cleanup', () => {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#f3ebdc';
  document.head.appendChild(meta);
  let listener: (state: { location: { pathname: string } }) => void = () => {};
  let unsubscribed = false;
  const cleanup = installPlayerTheme({
    state: { location: { pathname: '/login' } },
    subscribe: (next) => {
      listener = next;
      return () => {
        unsubscribed = true;
      };
    },
  });
  expect(document.documentElement.dataset.playerTheme).toBe('vivid');
  expect(meta.content).toBe('#111925');
  listener({ location: { pathname: '/admin' } });
  expect(document.documentElement.dataset.playerTheme).toBeUndefined();
  expect(meta.content).toBe('#f3ebdc');
  listener({ location: { pathname: '/gacha' } });
  expect(document.documentElement.dataset.playerTheme).toBe('vivid');
  cleanup();
  expect(unsubscribed).toBe(true);
  expect(document.documentElement.dataset.playerTheme).toBeUndefined();
  expect(meta.content).toBe('#f3ebdc');
  meta.remove();
});
