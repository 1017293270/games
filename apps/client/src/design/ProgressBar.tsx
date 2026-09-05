export interface ProgressBarProps {
  /** 0-1. Values outside the range are clamped. */
  value: number;
  tone?: 'ink' | 'gold' | 'cinnabar' | 'indigo';
  thin?: boolean;
  label?: string;
  className?: string;
}

export function ProgressBar({
  value,
  tone = 'ink',
  thin = false,
  label,
  className = '',
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const classes = ['bar', tone === 'ink' ? '' : `bar--${tone}`, thin ? 'bar--thin' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
      aria-label={label}
    >
      <div className="bar__fill" style={{ width: `${pct * 100}%` }} />
    </div>
  );
}
