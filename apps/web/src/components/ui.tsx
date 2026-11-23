import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ComponentProps, type HTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-pitch-500 text-ink hover:bg-pitch-400 shadow-lg shadow-pitch-500/20',
  secondary: 'bg-white/10 text-white hover:bg-white/15 ring-1 ring-inset ring-white/10',
  ghost: 'text-white/80 hover:bg-white/10 hover:text-white',
  danger: 'bg-red-500/15 text-red-300 hover:bg-red-500/25 ring-1 ring-inset ring-red-400/30',
  gold: 'bg-gold-400 text-ink hover:brightness-110 shadow-lg shadow-gold-400/20',
};

type Size = 'sm' | 'md' | 'lg';
const SIZES: Record<Size, string> = { sm: 'min-h-9 px-3 text-sm', md: 'min-h-11 px-4 text-sm', lg: 'min-h-13 px-6 text-base' };

export function buttonClass({ variant = 'primary', size = 'md', className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pitch-400 disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

/** A router link styled as a button (never a button inside a link). */
export function LinkButton({ variant, size, className, ...rest }: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link {...rest} className={buttonClass({ variant, size, className: className as string | undefined })} />;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={disabled || loading} className={buttonClass({ variant, size, className })}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} className={cx('rounded-2xl bg-night-800/80 p-4 shadow-xl shadow-black/30 ring-1 ring-white/5 sm:p-5', className)}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="font-display text-lg font-semibold uppercase tracking-wide text-white">{children}</h2>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className ?? 'size-5')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-white/5', className)} />;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-white/80">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-white/50">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return (
    <input
      {...rest}
      className={cx(
        'min-h-11 w-full rounded-xl bg-night-950/70 px-3 text-base text-white ring-1 ring-inset ring-white/10 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pitch-400 sm:text-sm',
        className,
      )}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-night-950/70 p-1 ring-1 ring-inset ring-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-9 flex-1 rounded-lg px-3 text-sm font-medium transition',
            value === o.value ? 'bg-pitch-500 text-ink' : 'text-white/70 hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-1 text-left"
    >
      <span>
        <span className="block text-sm font-medium text-white/90">{label}</span>
        {description && <span className="block text-xs text-white/50">{description}</span>}
      </span>
      <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-pitch-500' : 'bg-white/15')}>
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-snow shadow transition-all', checked ? 'left-5.5' : 'left-0.5')} />
      </span>
    </button>
  );
}

/** A dialog that is a bottom sheet on phones and a centred card on larger screens. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none rounded-t-3xl bg-night-800 p-0 text-white shadow-2xl ring-1 ring-white/10 backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <h2 id={titleId} className="font-display text-xl font-semibold uppercase tracking-wide">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-white/70 hover:bg-white/10" aria-label="Close">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-inset ring-red-400/20" role="alert">
      {children}
    </p>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'gold' | 'red' }) {
  const tones = {
    neutral: 'bg-white/10 text-white/70',
    green: 'bg-pitch-500/15 text-pitch-400',
    gold: 'bg-gold-400/15 text-gold',
    red: 'bg-red-500/15 text-red-300',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}
