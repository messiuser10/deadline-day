import { FORMATIONS, type FormationId } from '@deadline-day/engine';
import type { SeasonPlayerView } from '@deadline-day/protocol';
import { TeamBadge } from '../../components/team';
import { cx } from '../../components/ui';
import { TIER_CLASS, surname, tierOf } from '../../lib/auction';

interface TeamLike {
  name: string;
  color: string;
  monogram: string;
  kind: 'human' | 'bot' | 'ai';
}

/** Badge plus name; auction teams get a text tag so the highlight never relies on colour alone. */
/** `tag="wide"` drops the Auction tag below the sm breakpoint, for narrow tables that explain the bold names in a key. */
export function TeamName({ team, size = 'sm', tag = true, className }: { team: TeamLike | undefined; size?: 'sm' | 'md'; tag?: boolean | 'wide'; className?: string }) {
  if (!team) return <span className={className}>?</span>;
  return (
    <span className={cx('flex min-w-0 items-center gap-2', className)}>
      <TeamBadge color={team.color} monogram={team.monogram} size={size === 'md' ? 'md' : 'sm'} />
      <span className={cx('min-w-[3.5rem] truncate', team.kind !== 'ai' && 'font-semibold')}>{team.name}</span>
      {tag && team.kind !== 'ai' && (
        <span className={cx('shrink-0 rounded bg-gold-400/15 px-1.5 py-px text-[0.6rem] font-bold uppercase tracking-wide text-gold-400', tag === 'wide' && 'hidden sm:inline')}>Auction</span>
      )}
    </span>
  );
}

const FORM_CLASS: Record<string, string> = {
  W: 'bg-pitch-500 text-night-950',
  D: 'bg-white/25 text-white',
  L: 'bg-red-500/80 text-white',
};

/** Last five results as lettered chips (the letter carries the meaning, colour only helps). */
export function FormGuide({ form }: { form: string }) {
  if (!form) return <span className="text-white/30">-</span>;
  return (
    <span className="inline-flex gap-0.5" aria-label={`Form ${form.split('').join(' ')}`}>
      {form.split('').map((r, i) => (
        <span key={i} className={cx('grid size-4 place-items-center rounded-sm text-[0.6rem] font-bold', FORM_CLASS[r])}>
          {r}
        </span>
      ))}
    </span>
  );
}

export function Trophy({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('size-5', className)} fill="currentColor" aria-hidden="true">
      <path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.35A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.35 12H8a4 4 0 0 1-4-4V5h3V3Zm0 4H6v1a2 2 0 0 0 1 1.73V7Zm10 0v2.73A2 2 0 0 0 18 8V7h-1ZM6 20h12v1H6v-1Z" />
    </svg>
  );
}

/** A season XI on the pitch: overall, surname, and an optional stat line per player. */
export function SeasonPitch({ formation, players, note }: { formation: FormationId; players: SeasonPlayerView[]; note?: (p: SeasonPlayerView) => string | null }) {
  const coords = new Map(FORMATIONS[formation].slots.map((s) => [s.key, s]));
  return (
    <div className="pitch-stripes relative aspect-[4/5] w-full overflow-hidden rounded-2xl ring-1 ring-white/10 sm:aspect-[5/4] lg:aspect-[4/5]">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/15" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-[14%] w-[44%] -translate-x-1/2 border border-b-0 border-white/15" />
      {players.map((p) => {
        const c = coords.get(p.slotKey);
        if (!c) return null;
        const extra = note?.(p);
        return (
          <div
            key={p.slotKey}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
            style={{ left: `${4 + c.x * 0.92}%`, top: `${5 + c.y * 0.88}%` }}
            aria-label={`${p.slotKey}: ${p.name}, ${p.overall}${p.outOfPosition ? ', out of position' : ''}${p.reserve ? ', academy reserve' : ''}`}
          >
            <span className="relative">
              <span
                className={cx(
                  'grid size-9 place-items-center rounded-full font-display text-sm font-bold shadow-lg ring-2 ring-night-950 sm:size-10',
                  p.reserve ? 'bg-white/20 text-white' : TIER_CLASS[tierOf(p.overall)],
                )}
              >
                {p.overall}
              </span>
              {(p.outOfPosition || p.reserve) && (
                <span
                  className={cx('absolute -right-2 -top-1 rounded px-1 text-[0.55rem] font-bold leading-tight text-night-950', p.reserve ? 'bg-white' : 'bg-sky-500')}
                  title={p.reserve ? 'Academy Reserve' : 'Playing an alternate position'}
                >
                  {p.reserve ? 'RES' : 'ALT'}
                </span>
              )}
            </span>
            <span className="max-w-[4.5rem] truncate rounded bg-night-950/70 px-1 text-center text-[0.65rem] font-semibold leading-tight">
              {p.reserve ? 'Reserve' : surname(p.name)}
              {extra && <span className="block font-normal text-gold-400">{extra}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
