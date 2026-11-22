import { useToasts } from '../stores/toast';
import { cx } from './ui';

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={cx(
            'pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-left text-sm font-medium shadow-2xl ring-1 motion-safe:animate-[toast-in_200ms_ease-out]',
            t.tone === 'error' && 'bg-red-950 text-red-100 ring-red-400/30',
            t.tone === 'success' && 'bg-night-800 text-pitch-400 ring-pitch-400/30',
            t.tone === 'info' && 'bg-night-800 text-white ring-white/10',
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
