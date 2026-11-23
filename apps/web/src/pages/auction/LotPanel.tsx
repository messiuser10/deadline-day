import { useState, type FormEvent } from 'react';
import { QUICK_BID_STEPS } from '@deadline-day/protocol';
import { Button, Card, cx, Pill } from '../../components/ui';
import { TeamBadge } from '../../components/team';
import { useAction } from '../../hooks/useAction';
import { post } from '../../lib/api';
import { money } from '../../lib/format';
import { TIER_RING, tierOf } from '../../lib/auction';
import { Positions, StarButton, TeamTag, TierBadge, TimerRing, remainingFor, type RoomCtx } from './parts';

const REASONS: Record<string, string> = {
  NO_SLOT: 'No open slot in your XI he can play',
  WOULD_STRAND_TEAM: 'Buying him would leave a team unable to fill a slot',
  TEAM_FULL: 'Your XI is complete',
};

/** Bid amounts for the quick buttons (never below the minimum increment, no duplicates). */
function quickAmounts(current: number, minIncrement: number): { step: number; amount: number }[] {
  const seen = new Set<number>();
  const out: { step: number; amount: number }[] = [];
  for (const s of QUICK_BID_STEPS) {
    const step = Math.max(s, minIncrement);
    if (seen.has(step)) continue;
    seen.add(step);
    out.push({ step, amount: current + step });
  }
  return out;
}

function useBidding(ctx: RoomCtx) {
  const { auction, mine, base } = ctx;
  const { run, pending } = useAction();
  const lot = auction.lot;
  const elig = lot && mine ? lot.eligibility[mine.id] : undefined;
  const leading = !!lot && !!mine && lot.leaderId === mine.id;
  const canBid = !!lot && !!mine && !auction.paused && !!elig?.ok && !leading;
  const placeBid = (amountM: number) => {
    if (!lot) return;
    void run('bid', () => post(`${base}/auction/bid`, { amountM, seenBidM: lot.currentBidM, lotSequence: lot.sequence })).then((res) => {
      if (res) navigator.vibrate?.(15);
    });
  };
  return { lot, elig, leading, canBid, placeBid, pending };
}

export function LotPanel({ ctx, now }: { ctx: RoomCtx; now: number }) {
  const { auction, teamsById, playersById, mine } = ctx;
  const lot = auction.lot;
  const { remainingMs, totalMs, paused } = remainingFor(auction, now);

  if (!lot) return <NominationPanel ctx={ctx} now={now} />;
  const player = playersById.get(lot.playerId)!;
  const leader = teamsById.get(lot.leaderId);
  const tier = tierOf(player.overall);
  const cue = paused ? null : remainingMs <= 2500 ? 'Going twice' : remainingMs <= 5000 ? 'Going once' : null;

  return (
    <Card className={cx('relative overflow-hidden ring-2', TIER_RING[tier])}>
      <div className="flex items-start gap-3">
        <TierBadge overall={player.overall} size="xl" showLabel />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-pitch-400">
                Lot {lot.sequence}
                {lot.autoNominated && <span className="ml-2 text-gold-400">Auto-nominated</span>}
              </p>
              <h2 className="truncate font-display text-2xl font-bold uppercase leading-tight sm:text-3xl">{player.name}</h2>
            </div>
            {mine && <StarButton on={ctx.watch.has(player.id)} onClick={() => ctx.toggleWatch(player.id)} label={player.name} />}
          </div>
          <Positions player={player} className="mt-1" />
          <p className="mt-1 truncate text-xs text-white/55">
            {[player.clubNow, player.nationality].filter(Boolean).join(' · ') || 'Club not listed'}
          </p>
          <p className="mt-1 text-xs text-white/55">
            Value {money(player.marketValueM)} · Base {money(player.basePriceM)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 rounded-2xl bg-night-950/60 p-3 ring-1 ring-white/5">
        <TimerRing remainingMs={remainingMs} totalMs={totalMs} paused={paused} />
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-white/50">Current bid</p>
          <p key={lot.currentBidM} className="font-display text-4xl font-bold text-gold-400 tabular-nums origin-left motion-safe:animate-[bump_0.25s_ease-out]">
            {money(lot.currentBidM)}
          </p>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="text-white/50">Leader</span>
            <TeamTag team={leader} />
            {leader?.id === mine?.id && <Pill tone="green">You</Pill>}
          </div>
        </div>
      </div>
      <p className={cx('mt-2 h-5 text-center font-display text-sm uppercase tracking-[0.3em]', cue ? 'text-red-400 motion-safe:animate-pulse' : 'text-transparent')} aria-live="polite">
        {cue ?? '·'}
      </p>

      {mine && (
        <div className="hidden lg:block">
          <BidControls ctx={ctx} />
        </div>
      )}
      <BidHistory ctx={ctx} />
    </Card>
  );
}

function NominationPanel({ ctx, now }: { ctx: RoomCtx; now: number }) {
  const { auction, teamsById, mine } = ctx;
  const { remainingMs, totalMs, paused } = remainingFor(auction, now);
  const nominator = auction.nominatorId ? teamsById.get(auction.nominatorId) : undefined;
  const myTurn = !!mine && auction.nominatorId === mine.id;
  return (
    <Card className={cx('ring-2', myTurn ? 'ring-pitch-400/60' : 'ring-white/5')}>
      <div className="flex items-center gap-4">
        <TimerRing remainingMs={remainingMs} totalMs={totalMs} paused={paused} label="nominate" />
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.2em] text-pitch-400">Nomination</p>
          {myTurn ? (
            <>
              <h2 className="font-display text-2xl font-bold uppercase">Your turn</h2>
              <p className="text-sm text-white/65">Pick a player from the pool and set the opening bid. If the clock runs out, the best player you can afford is nominated at base price.</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {nominator && <TeamBadge color={nominator.color} monogram={nominator.monogram} size="sm" />}
                <h2 className="truncate font-display text-2xl font-bold uppercase">{nominator?.teamName ?? '...'}</h2>
              </div>
              <p className="text-sm text-white/65">
                {nominator?.isBot || nominator?.control === 'bot' ? 'The bot is choosing a player.' : nominator?.control === 'auto' ? 'Auto-nominating for this team.' : `${nominator?.managerName ?? 'They'} is choosing a player.`}
              </p>
            </>
          )}
        </div>
      </div>
      {myTurn && (
        <Button className="mt-4 hidden w-full lg:flex" onClick={() => document.getElementById('pool-panel')?.scrollIntoView({ behavior: 'smooth' })}>
          Choose from the pool
        </Button>
      )}
    </Card>
  );
}

export function BidControls({ ctx, compact = false }: { ctx: RoomCtx; compact?: boolean }) {
  const { auction } = ctx;
  const { lot, elig, leading, canBid, placeBid, pending } = useBidding(ctx);
  const minNext = lot ? lot.currentBidM + auction.timers.minIncrementM : 0;
  const [custom, setCustom] = useState('');
  if (!lot) return null;
  const max = elig?.maxBidM ?? 0;
  const amounts = quickAmounts(lot.currentBidM, auction.timers.minIncrementM);
  const status = auction.paused ? 'Paused' : leading ? 'You are the highest bidder' : elig && !elig.ok ? (REASONS[elig.code ?? ''] ?? 'You cannot bid on this player') : null;

  const submitCustom = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(custom);
    if (!Number.isFinite(n) || n <= 0) return;
    placeBid(n);
    setCustom('');
  };

  return (
    <div className={cx(compact ? '' : 'mt-2')}>
      {!compact && (
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-white/60">Your max bid</span>
          <span className="font-display text-lg font-semibold tabular-nums">{elig?.ok ? money(max) : '—'}</span>
        </div>
      )}
      {status && <p className={cx('mb-2 text-center text-sm', leading ? 'text-pitch-400' : 'text-white/60')}>{status}</p>}
      <div className="grid grid-cols-4 gap-2">
        {amounts.map(({ step, amount }) => (
          <Button
            key={step}
            size={compact ? 'md' : 'lg'}
            variant={step === amounts[0]!.step ? 'primary' : 'secondary'}
            disabled={!canBid || amount > max || pending === 'bid'}
            onClick={() => placeBid(amount)}
            className="flex-col gap-0 px-1 leading-tight"
            aria-label={`Bid ${money(amount)}`}
          >
            <span className="font-display text-base">+{step}</span>
            <span className="text-[0.7rem] font-medium opacity-80">{money(amount)}</span>
          </Button>
        ))}
      </div>
      {!compact && (
        <form onSubmit={submitCustom} className="mt-2 flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={minNext}
            max={max}
            step={1}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={`Custom, ${minNext} to ${Math.max(minNext, max)}`}
            aria-label="Custom bid in millions"
            disabled={!canBid}
            className="min-h-11 min-w-0 flex-1 rounded-xl bg-night-950/70 px-3 text-base tabular-nums ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-2 focus:ring-pitch-400 disabled:opacity-50 sm:text-sm"
          />
          <Button type="submit" variant="gold" disabled={!canBid || !custom} loading={pending === 'bid'}>
            Bid
          </Button>
        </form>
      )}
    </div>
  );
}

function BidHistory({ ctx }: { ctx: RoomCtx }) {
  const lot = ctx.auction.lot!;
  const bids = [...lot.bids].reverse();
  return (
    <details className="group mt-3" open>
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm text-white/60">
        <span>Bid history ({lot.bids.length})</span>
        <svg viewBox="0 0 24 24" className="size-4 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" />
        </svg>
      </summary>
      <ol className="max-h-40 overflow-y-auto pr-1">
        {bids.map((b, i) => {
          const team = ctx.teamsById.get(b.participantId);
          return (
            <li key={`${b.at}-${b.participantId}-${b.amountM}`} className={cx('flex items-center justify-between gap-2 py-1 text-sm', i > 0 && 'text-white/55')}>
              <span className="flex min-w-0 items-center gap-2">
                <TeamTag team={team} />
                {b.isBot && <Pill>Bot</Pill>}
                {i === bids.length - 1 && <span className="text-xs text-white/40">opening</span>}
              </span>
              <span className="font-display tabular-nums">{money(b.amountM)}</span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

/** Phones: a bar fixed to the bottom with the clock and one-tap bids, or the nominate prompt. */
export function MobileActionBar({ ctx, now, onPickPlayer }: { ctx: RoomCtx; now: number; onPickPlayer: () => void }) {
  const { auction, mine } = ctx;
  if (!mine || auction.phase === 'complete') return null;
  const { remainingMs, totalMs, paused } = remainingFor(auction, now);
  const myTurn = auction.phase === 'nominating' && auction.nominatorId === mine.id;
  if (!auction.lot && !myTurn) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-night-900/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl backdrop-blur lg:hidden">
      {auction.lot ? (
        <div className="flex items-center gap-3">
          <TimerRing remainingMs={remainingMs} totalMs={totalMs} paused={paused} size={52} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs text-white/60">
              <span className="truncate">{ctx.playersById.get(auction.lot.playerId)?.name}</span>
              <span className="font-display text-base text-gold-400 tabular-nums">{money(auction.lot.currentBidM)}</span>
            </div>
            <BidControls ctx={ctx} compact />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <TimerRing remainingMs={remainingMs} totalMs={totalMs} paused={paused} size={52} />
          <Button className="flex-1" size="lg" onClick={onPickPlayer} disabled={paused}>
            Your turn: choose a player
          </Button>
        </div>
      )}
    </div>
  );
}
