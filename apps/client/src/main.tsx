import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import './design/base.css';
import './design/components.css';
import './shell/shell.css';
import { App } from './app/App';

async function boot(): Promise<void> {
  // The mock world is a separate chunk: a production build without VITE_MOCK
  // never downloads it.
  if (import.meta.env.VITE_MOCK === '1') {
    const { installMock } = await import('./api/mock');
    installMock();
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('#root missing from index.html');

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
