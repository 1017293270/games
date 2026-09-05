import { useEffect, type ReactNode } from 'react';
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
          role="dialog"
          aria-modal="true"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="sheet__grip" />
          {title !== undefined && <h2 className="sheet__title ink-display">{title}</h2>}
          {children}
        </div>
      </div>
    </Overlay>
  );
}
