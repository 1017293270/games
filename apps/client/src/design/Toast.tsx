import { useUiStore } from '../store/ui';
import { Overlay } from './Overlay';

export function ToastHost() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <Overlay>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`toast ${item.tone === 'info' ? '' : `toast--${item.tone}`}`}
            onClick={() => dismiss(item.id)}
          >
            {item.text}
          </button>
        ))}
      </div>
    </Overlay>
  );
}
