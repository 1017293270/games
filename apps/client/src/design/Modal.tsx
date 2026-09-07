import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Overlay } from './Overlay';

export interface ModalProps {
  open: boolean;
  title?: ReactNode;
  lede?: ReactNode;
  onClose?: () => void;
  /** Clicking the scrim closes by default; turn off for blocking moments. */
  dismissable?: boolean;
  children: ReactNode;
}

export function Modal({ open, title, lede, onClose, dismissable = true, children }: ModalProps) {
  useEffect(() => {
    if (!open || !dismissable || !onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissable, onClose]);

  if (!open) return null;

  return (
    <Overlay>
      <div
        className="scrim scrim--center"
        onClick={dismissable && onClose ? onClose : undefined}
        role="presentation"
      >
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          onClick={(event) => event.stopPropagation()}
        >
          {title !== undefined && <h2 className="modal__title ink-display">{title}</h2>}
          {lede !== undefined && <p className="modal__lede">{lede}</p>}
          {children}
        </div>
      </div>
    </Overlay>
  );
}

export interface SheetProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet, used for anything that is a drill-down rather than a decision. */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', trap);
    return () => {
      window.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Overlay>
      <div className="scrim scrim--bottom" onClick={onClose} role="presentation">
        <div
          className="sheet"
          ref={dialog}
          tabIndex={-1}
          aria-labelledby={title !== undefined ? titleId : undefined}
          role="dialog"
          aria-modal="true"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="sheet__grip" />
          <button
            type="button"
            className="btn btn--quiet"
            onClick={onClose}
            aria-label="关闭面板"
            style={{ float: 'right' }}
          >
            关闭 ×
          </button>
          {title !== undefined && (
            <h2 id={titleId} className="sheet__title ink-display">
              {title}
            </h2>
          )}
          {children}
        </div>
      </div>
    </Overlay>
  );
}
