import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { errorMessage } from '../api/http';

/**
 * The console's instrument kit.
 *
 * Two rules hold the whole panel together:
 *   - every editable control can be marked 朱批 (`dirty`), which paints a
 *     cinnabar tick in its gutter until the change is written back;
 *   - every number is tabular and carries its own range, so an operator can
 *     read a value's position in its legal band without consulting the docs.
 */

/* ------------------------------------------------------------------ 取数 */

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-runs the fetch, keeping the last good data on screen while it runs. */
  reload: () => void;
  /** Replaces the held value after a write, so no round trip is needed. */
  set: (next: T) => void;
}

/**
 * Runs `fetcher` on mount and whenever `key` changes.
 *
 * `key` is a string the caller builds from its query, which keeps the
 * dependency honest without asking every call site for a `useCallback`.
 */
export function useAsync<T>(fetcher: () => Promise<T>, key: string): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const latest = useRef(fetcher);
  latest.current = fetcher;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    latest
      .current()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, set: setData };
}

/* ------------------------------------------------------------- 结构与提示 */

export function Seal({ children }: { children: ReactNode }) {
  return <span className="adm-seal">{children}</span>;
}

export function Section({
  title,
  lede,
  actions,
  children,
}: {
  title: string;
  lede?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="adm-section">
      <header className="adm-section__head">
        <div>
          <h2 className="adm-section__title ink-display">{title}</h2>
          {lede ? <p className="adm-section__lede">{lede}</p> : null}
        </div>
        {actions ? <div className="adm-section__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'done';
  children: ReactNode;
}) {
  return (
    <p className={`adm-notice adm-notice--${tone}`} role={tone === 'warn' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="adm-stat">
      <span className="adm-stat__label">{label}</span>
      <span className="adm-stat__value numeral">{value}</span>
      {note ? <span className="adm-stat__note">{note}</span> : null}
    </div>
  );
}

/* --------------------------------------------------------------- 输入控件 */

interface FieldFrameProps {
  label: string;
  hint?: string;
  dirty?: boolean;
  children: ReactNode;
}

function FieldFrame({ label, hint, dirty, children }: FieldFrameProps) {
  return (
    <label className={`adm-field${dirty ? ' is-dirty' : ''}`}>
      <span className="adm-field__label">
        {label}
        {dirty ? <span className="sr-only">（已改动，尚未存档）</span> : null}
      </span>
      {children}
      {hint ? <span className="adm-field__hint">{hint}</span> : null}
    </label>
  );
}

export interface NumFieldProps {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  dirty?: boolean;
  disabled?: boolean;
}

/**
 * A number with its legal band drawn underneath.
 *
 * The stepper buttons exist because most of these knobs are nudged rather than
 * retyped, and the fill bar answers "is 2.5 a lot?" without a lookup.
 */
export function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  hint,
  dirty,
  disabled,
}: NumFieldProps) {
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));
  const fill = max > min ? (clamp(value) - min) / (max - min) : 0;
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0;
  const nudge = (delta: number): void => onChange(Number(clamp(value + delta).toFixed(decimals)));

  return (
    <FieldFrame label={label} hint={hint} dirty={dirty}>
      <span className="adm-num">
        <button
          type="button"
          className="adm-num__step"
          onClick={() => nudge(-step)}
          disabled={disabled || value <= min}
          aria-label={`${label} 减 ${step}`}
        >
          −
        </button>
        <span className="adm-num__box">
          <input
            className="adm-num__input numeral"
            type="number"
            inputMode="decimal"
            value={value}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(next);
            }}
          />
          {unit ? <span className="adm-num__unit">{unit}</span> : null}
          <span className="adm-num__gauge" style={{ '--fill': `${fill * 100}%` } as React.CSSProperties} />
        </span>
        <button
          type="button"
          className="adm-num__step"
          onClick={() => nudge(step)}
          disabled={disabled || value >= max}
          aria-label={`${label} 加 ${step}`}
        >
          ＋
        </button>
        <span className="adm-num__range numeral">
          {min} – {max}
        </span>
      </span>
    </FieldFrame>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  dirty,
  placeholder,
  maxLength,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  dirty?: boolean;
  placeholder?: string;
  maxLength?: number;
  type?: 'text' | 'password';
}) {
  return (
    <FieldFrame label={label} hint={hint} dirty={dirty}>
      <input
        className="adm-input"
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldFrame>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  hint,
  dirty,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  dirty?: boolean;
  maxLength?: number;
}) {
  return (
    <FieldFrame label={label} hint={hint} dirty={dirty}>
      <textarea
        className="adm-input adm-input--area"
        value={value}
        rows={3}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldFrame>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  dirty,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: string;
  dirty?: boolean;
}) {
  return (
    <FieldFrame label={label} hint={hint} dirty={dirty}>
      <select className="adm-input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  hint,
  dirty,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
  dirty?: boolean;
}) {
  return (
    <div className={`adm-field adm-field--toggle${dirty ? ' is-dirty' : ''}`}>
      <button
        type="button"
        className={`adm-toggle${value ? ' is-on' : ''}`}
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
      >
        <span className="adm-toggle__track" aria-hidden="true">
          <span className="adm-toggle__knob" />
        </span>
        <span className="adm-toggle__label">{label}</span>
        <span className="adm-toggle__state numeral">{value ? '开' : '关'}</span>
      </button>
      {hint ? <span className="adm-field__hint">{hint}</span> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- 表格 */

export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="adm-scroll">{children}</div>;
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (next: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="adm-pager">
      <span className="adm-pager__count numeral">
        共 {total} 条 · 第 {page} / {pages} 页
      </span>
      <span className="adm-pager__buttons">
        <button
          type="button"
          className="adm-btn adm-btn--quiet"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          上一页
        </button>
        <button
          type="button"
          className="adm-btn adm-btn--quiet"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
        >
          下一页
        </button>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ 杂项 */

/** `2026-09-05 07:20:11`, in the operator's own timezone. */
export function stamp(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const date = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** `3 分 20 秒`, for uptimes and "how long ago". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 时 ${m % 60} 分`;
  return `${Math.floor(h / 24)} 天 ${h % 24} 时`;
}

/** A clock that re-renders its consumer once a second. */
export function useTicker(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
