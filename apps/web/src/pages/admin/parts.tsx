import { useEffect, useId, useState, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { Distribution, GameStatus } from '@deadline-day/protocol';
import { errorMessage } from '../../lib/api';
import { toast } from '../../stores/toast';
import { Button, cx } from '../../components/ui';

/** Where to watch a game in its current state. */
export function gameHref(status: GameStatus, code: string): string {
  switch (status) {
    case 'auctioning':
    case 'paused':
    case 'auction_complete':
      return `/auction/${code}`;
    case 'simulating':
      return `/season/${code}`;
    case 'completed':
      return `/results/${code}`;
    default:
      return `/lobby/${code}`;
  }
}

export const STATUS_LABEL: Record<GameStatus, string> = {
  lobby: 'Lobby',
  auctioning: 'Auction',
  paused: 'Paused',
  auction_complete: 'Reveal',
  simulating: 'Season',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function age(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export const pct = (n: number, dp = 0) => `${(n * 100).toFixed(dp)}%`;

export function AdminHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-white/60">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** A mutation that toasts its error (and an optional success line) and refreshes the given queries. */
export function useAdminMutation<I, O>(fn: (input: I) => Promise<O>, opts: { invalidate?: QueryKey[]; success?: string | ((out: O) => string); onSuccess?: (out: O) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      const msg = typeof opts.success === 'function' ? opts.success(out) : opts.success;
      if (msg) toast(msg, 'success');
      opts.onSuccess?.(out);
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
}

const fieldClass =
  'min-h-11 w-full rounded-xl bg-night-950/70 px-3 text-base text-white ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-2 focus:ring-pitch-400 sm:text-sm';

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(fieldClass, 'pr-8', className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(fieldClass, 'py-2 font-mono text-xs leading-relaxed', className)} />;
}

/** Number input that keeps a draft while typing and reports a number (or null when empty). */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  ...rest
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  id?: string;
  'aria-label'?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = e.target.value === '' ? null : Number(e.target.value);
        if (n === null || Number.isFinite(n)) onChange(n);
      }}
      className={cx(fieldClass, 'tabular-nums', className)}
    />
  );
}

/** A danger button that needs a second tap within four seconds. */
export function ConfirmButton({
  label,
  confirm,
  onConfirm,
  disabled,
  loading,
  size = 'sm',
}: {
  label: string;
  confirm: string;
  onConfirm: () => void;
  disabled?: boolean;
  loading?: boolean;
  size?: 'sm' | 'md';
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <Button
      variant="danger"
      size={size}
      disabled={disabled}
      loading={loading}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirm : label}
    </Button>
  );
}

export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'gold' | 'red' }) {
  return (
    <div className="min-w-0 rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/5">
      <p className="truncate text-[0.7rem] font-semibold uppercase tracking-wide text-white/50">{label}</p>
      <p className={cx('mt-0.5 font-display text-2xl font-bold tabular-nums sm:text-3xl', tone === 'gold' && 'text-gold', tone === 'red' && 'text-red-300')}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-white/50">{hint}</p>}
    </div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-night-950/40 px-4 py-6 text-center text-sm text-white/50">{children}</p>;
}

/** Download link for a same-origin GET export (the session cookie goes with it). */
export function DownloadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      download
      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-semibold text-white ring-1 ring-inset ring-white/10 transition hover:bg-white/15"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </a>
  );
}

const BAR = '#179a53';

/**
 * Histogram of a lab distribution: thin bars on a recessive axis, a hover/tap tooltip per bar, and a
 * table view of the same numbers.
 */
export function Histogram({ title, dist, unit, format = (n) => String(n), integer }: { title: string; dist: Distribution; unit: string; format?: (n: number) => string; integer?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const max = Math.max(1, ...dist.bins.map((b) => b.count));
  const total = dist.bins.reduce((s, b) => s + b.count, 0);
  const label = (b: Distribution['bins'][number]) => (integer && b.to - b.from === 1 ? format(b.from) : `${format(b.from)}–${format(b.to)}`);
  const W = 320;
  const H = 120;
  const gap = 2;
  const bw = dist.bins.length ? (W - gap * (dist.bins.length - 1)) / dist.bins.length : W;
  const active = hover === null ? null : dist.bins[hover];
  return (
    <figure className="min-w-0 rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/5" aria-labelledby={id}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <figcaption id={id} className="min-w-0">
          <span className="block text-sm font-semibold text-white/90">{title}</span>
          <span className="block text-xs text-white/50">
            Mean {format(dist.mean)} · range {format(dist.min)} to {format(dist.max)}
          </span>
        </figcaption>
        <button type="button" onClick={() => setTable((v) => !v)} className="shrink-0 rounded-lg px-2 py-1 text-xs text-white/60 ring-1 ring-white/10 hover:text-white">
          {table ? 'Chart' : 'Table'}
        </button>
      </div>
      {table ? (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-white/45">
                <th className="py-1 font-medium" scope="col">{unit}</th>
                <th className="py-1 text-right font-medium" scope="col">Count</th>
                <th className="py-1 text-right font-medium" scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {dist.bins.map((b) => (
                <tr key={b.from} className="border-t border-white/5">
                  <td className="py-1">{label(b)}</td>
                  <td className="py-1 text-right">{b.count}</td>
                  <td className="py-1 text-right text-white/60">{pct(b.count / Math.max(1, total), 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H + 16}`} className="block h-auto w-full" role="img" aria-label={`${title}: ${dist.bins.length} bins, mean ${format(dist.mean)}`} onMouseLeave={() => setHover(null)}>
            <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="currentColor" className="text-white/15" />
            {dist.bins.map((b, i) => {
              const h = b.count ? Math.max(2, (b.count / max) * (H - 6)) : 0;
              const x = i * (bw + gap);
              const r = Math.min(4, bw / 2, h);
              return (
                <g key={b.from}>
                  {h > 0 && (
                    <path
                      d={`M${x},${H} V${H - h + r} Q${x},${H - h} ${x + r},${H - h} H${x + bw - r} Q${x + bw},${H - h} ${x + bw},${H - h + r} V${H} Z`}
                      fill={BAR}
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  )}
                  <rect x={x - gap / 2} y={0} width={bw + gap} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                </g>
              );
            })}
            <text x="0" y={H + 13} fill="currentColor" className="text-white/45" fontSize="10">
              {format(dist.min)}
            </text>
            <text x={W} y={H + 13} fill="currentColor" className="text-white/45" fontSize="10" textAnchor="end">
              {format(dist.max)}
            </text>
          </svg>
          {active && (
            <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg bg-night-700 px-2 py-1 text-xs text-white shadow-lg ring-1 ring-white/10" role="status">
              <span className="font-semibold">
                {label(active)} {unit}
              </span>
              <span className="text-white/60"> · {active.count} ({pct(active.count / Math.max(1, total), 1)})</span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
