interface LocationState {
  location: { pathname: string };
}
interface LocationSource {
  state: LocationState;
  subscribe: (listener: (state: LocationState) => void) => () => void;
}

/** Scope pigment tokens to player routes, including portals outside the router. */
export function installPlayerTheme(source: LocationSource): () => void {
  const root = document.documentElement;
  const previous = root.dataset.playerTheme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const previousColor = meta?.content;
  const apply = ({ location }: LocationState) => {
    const player = !/^\/admin(?:\/|$)/.test(location.pathname);
    if (player) root.dataset.playerTheme = 'vivid';
    else delete root.dataset.playerTheme;
    if (meta) meta.content = player ? '#111925' : (previousColor ?? '#f3ebdc');
  };
  apply(source.state);
  const unsubscribe = source.subscribe(apply);
  return () => {
    unsubscribe();
    if (previous === undefined) delete root.dataset.playerTheme;
    else root.dataset.playerTheme = previous;
    if (meta && previousColor !== undefined) meta.content = previousColor;
  };
}
