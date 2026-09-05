import type { ReactNode } from 'react';

export interface PanelProps {
  title?: ReactNode;
  aside?: ReactNode;
  sunk?: boolean;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, aside, sunk, flush, className = '', children }: PanelProps) {
  const classes = ['panel', sunk ? 'panel--sunk' : '', flush ? 'panel--flush' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <section className={classes}>
      {title !== undefined && (
        <header className="panel__head">
          <h2 className="panel__title">{title}</h2>
          {aside !== undefined && <div className="panel__aside">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
