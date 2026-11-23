import type { AuctionPlayerView, AuctionTeamView, AuctionView, GameSnapshot, ParticipantView, UserView } from '@deadline-day/protocol';
import { cx } from '../../components/ui';
import { TeamBadge } from '../../components/team';
import { TIER_CLASS, TIER_LABEL, seconds, tierOf, type Buyability } from '../../lib/auction';

/** Everything the auction room's panels share. */
export interface RoomCtx {
  snap: GameSnapshot;
  auction: AuctionView;
  me: UserView | null | undefined;
  mine: ParticipantView | undefined;
  myTeam: AuctionTeamView | undefined;
  canHost: boolean;
  base: string;
  teamsById: Map<string, ParticipantView>;
  playersById: Map<string, AuctionPlayerView>;
  /** My team's buyability per available player (null for spectators). */
  buy: Map<string, Buyability> | null;
  watch: Set<string>;
  toggleWatch: (playerId: string) => void;
  openNominate: (playerId: string) => void;
}

export function TierBadge({ overall, size = 'md', showLabel = false }: { overall: number; size?: 'sm' | 'md' | 'lg' | 'xl'; showLabel?: boolean }) {
  const tier = tierOf(overall);
  const sizes = { sm: 'size-8 text-sm', md: 'size-10 text-base', lg: 'size-14 text-2xl', xl: 'size-20 text-4xl' };
  return (
    <span className="inline-flex shrink-0 flex-col items-center gap-0.5">
      <span
        className={cx('grid place-items-center rounded-xl font-display font-bold tabular-nums shadow-md', sizes[size], TIER_CLASS[tier])}
        title={`${TIER_LABEL[tier]} tier`}
      >
        {overall}
      </span>
      {showLabel && <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-white/60">{TIER_LABEL[tier]}</span>}
    </span>
  );
}

export function Positions({ player, className }: { player: Pick<AuctionPlayerView, 'position' | 'altPositions'>; className?: string }) {
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-1', className)}>
      <span className="rounded bg-pitch-500/20 px-1.5 py-0.5 text-[0.7rem] font-bold text-pitch-400">{player.position}</span>
      {player.altPositions.map((p) => (
        <span key={p} className="rounded bg-white/10 px-1.5 py-0.5 text-[0.7rem] font-semibold text-white/70">
          {p}
        </span>
      ))}
    </span>
  );
}

export function TeamTag({ team, className }: { team: ParticipantView | undefined; className?: string }) {
  if (!team) return null;
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5', className)}>
      <TeamBadge color={team.color} monogram={team.monogram} size="sm" />
      <span className="truncate font-semibold">{team.teamName}</span>
    </span>
  );
}

/** Countdown ring: shrinks with the clock, turns red under 5 seconds, frozen while paused. */
export function TimerRing({
  remainingMs,
  totalMs,
  size = 88,
  paused = false,
  label,
}: {
  remainingMs: number;
  totalMs: number;
  size?: number;
  paused?: boolean;
  label?: string;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remainingMs / Math.max(1, totalMs)));
  const danger = !paused && remainingMs < 5000;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="timer" aria-label={`${seconds(remainingMs)} seconds left`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-white/10" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className={cx('transition-[stroke-dashoffset] duration-200 ease-linear', paused ? 'stroke-white/40' : danger ? 'stroke-red-500' : 'stroke-pitch-400')}
        />
      </svg>
      <span className={cx('font-display font-bold tabular-nums', size >= 80 ? 'text-3xl' : 'text-lg', danger && 'text-red-400', paused && 'text-white/50')}>
        {seconds(remainingMs)}
      </span>
      {label && <span className="absolute -bottom-1 text-[0.6rem] uppercase tracking-wider text-white/50">{label}</span>}
    </div>
  );
}

/** Remaining time on the clock that is running (or frozen while paused). */
export function remainingFor(auction: AuctionView, now: number): { remainingMs: number; totalMs: number; paused: boolean } {
  if (auction.paused) {
    const totalMs = auction.paused.timer === 'lot' ? auction.timers.lotMs : auction.timers.nominationMs;
    return { remainingMs: auction.paused.remainingMs, totalMs: Math.max(totalMs, auction.paused.remainingMs), paused: true };
  }
  if (auction.phase === 'bidding' && auction.lotDeadline) {
    const remainingMs = auction.lotDeadline - now;
    return { remainingMs, totalMs: Math.max(auction.timers.lotMs, remainingMs), paused: false };
  }
  if (auction.phase === 'nominating' && auction.nominationDeadline) {
    return { remainingMs: auction.nominationDeadline - now, totalMs: auction.timers.nominationMs, paused: false };
  }
  return { remainingMs: 0, totalMs: 1, paused: false };
}

export function StarButton({ on, onClick, label, tabIndex }: { on: boolean; onClick: () => void; label: string; tabIndex?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={tabIndex}
      aria-pressed={on}
      aria-label={on ? `Remove ${label} from watchlist` : `Add ${label} to watchlist`}
      className={cx('grid size-10 shrink-0 place-items-center rounded-full transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-pitch-400', on ? 'text-gold' : 'text-white/35')}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
