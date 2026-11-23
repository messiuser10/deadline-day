import { useState, type DragEvent } from 'react';
import { FORMATIONS, isEligible, type FormationId } from '@deadline-day/engine';
import type { AuctionPlayerView, AuctionSlotView } from '@deadline-day/protocol';
import { Card, CardTitle, cx, Pill } from '../../components/ui';
import { useAction } from '../../hooks/useAction';
import { post } from '../../lib/api';
import { money } from '../../lib/format';
import { TIER_CLASS, surname, tierOf } from '../../lib/auction';
import type { RoomCtx } from './parts';

interface PitchProps {
  formation: FormationId;
  slots: AuctionSlotView[];
  playersById: Map<string, AuctionPlayerView>;
  size?: 'sm' | 'md';
  /** Enables tap-to-swap and drag-and-drop. */
  onSwap?: (a: string, b: string) => void;
}

/** The formation on a pitch: filled slots show overall, surname, price and an alternate-position tag. */
export function PitchView({ formation, slots, playersById, size = 'md', onSwap }: PitchProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const coords = new Map(FORMATIONS[formation].slots.map((s) => [s.key, s]));
  const byKey = new Map(slots.map((s) => [s.key, s]));
  const sel = selected ? byKey.get(selected) : undefined;
  const selPlayer = sel?.playerId ? playersById.get(sel.playerId) : undefined;

  /** Both players can play the other's slot (an empty slot only needs the moving player to fit). */
  const canSwapWith = (target: AuctionSlotView) => {
    if (!sel || !selPlayer || target.key === sel.key) return false;
    if (!isEligible(selPlayer, target.type)) return false;
    const other = target.playerId ? playersById.get(target.playerId) : undefined;
    return !other || isEligible(other, sel.type);
  };

  const tap = (s: AuctionSlotView) => {
    if (!onSwap) return;
    if (selected === s.key) return setSelected(null);
    if (sel && canSwapWith(s)) {
      onSwap(sel.key, s.key);
      return setSelected(null);
    }
    setSelected(s.playerId ? s.key : null);
  };

  const onDrop = (e: DragEvent, target: string) => {
    e.preventDefault();
    const from = e.dataTransfer.getData('text/slot');
    if (onSwap && from && from !== target) onSwap(from, target);
    setSelected(null);
  };

  const small = size === 'sm';
  return (
    <div className={cx('pitch-stripes relative w-full overflow-hidden rounded-2xl ring-1 ring-white/10', small ? 'aspect-[5/4]' : 'aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5]')}>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/15" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-[14%] w-[44%] -translate-x-1/2 border border-b-0 border-white/15" />
      {slots.map((s) => {
        const c = coords.get(s.key);
        if (!c) return null;
        const p = s.playerId ? playersById.get(s.playerId) : undefined;
        const target = sel ? canSwapWith(s) : false;
        return (
          <button
            key={s.key}
            type="button"
            disabled={!onSwap}
            onClick={() => tap(s)}
            draggable={!!onSwap && !!p}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/slot', s.key);
              setSelected(s.key);
            }}
            onDragOver={(e) => onSwap && e.preventDefault()}
            onDrop={(e) => onDrop(e, s.key)}
            aria-label={p ? `${s.key}: ${p.name}, ${p.overall}${s.outOfPosition ? ', alternate position' : ''}` : `${s.key}: empty`}
            className={cx(
              'absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded-xl p-0.5 transition disabled:cursor-default',
              selected === s.key && 'bg-white/20 ring-2 ring-gold-400',
              target && 'bg-pitch-400/25 ring-2 ring-pitch-400 motion-safe:animate-pulse',
            )}
            style={{ left: `${4 + c.x * 0.92}%`, top: `${5 + c.y * 0.88}%` }}
          >
            {p ? (
              <span className="relative">
                <span className={cx('grid place-items-center rounded-full font-display font-bold shadow-lg ring-2 ring-night-950', small ? 'size-7 text-xs' : 'size-9 text-sm sm:size-10', TIER_CLASS[tierOf(p.overall)])}>
                  {p.overall}
                </span>
                {s.outOfPosition && (
                  <span className="absolute -right-2 -top-1 rounded bg-sky-500 px-1 text-[0.55rem] font-bold leading-tight text-night-950" title="Playing an alternate position">
                    ALT
                  </span>
                )}
              </span>
            ) : (
              <span className={cx('grid place-items-center rounded-full border-2 border-dashed border-white/35 bg-night-950/40 font-display font-semibold text-white/60', small ? 'size-7 text-[0.55rem]' : 'size-9 text-[0.65rem] sm:size-10')}>
                {s.type}
              </span>
            )}
            {!small && (
              <span className="max-w-[4.5rem] truncate rounded bg-night-950/70 px-1 text-[0.65rem] font-semibold leading-tight">
                {p ? surname(p.name) : ''}
                {p && s.priceM !== null && <span className="block text-center font-normal text-gold-400">{s.autoFilled ? 'auto ' : ''}{money(s.priceM)}</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function MyTeamCard({ ctx, className }: { ctx: RoomCtx; className?: string }) {
  const { mine, myTeam, auction, playersById, base } = ctx;
  const { run } = useAction();
  if (!mine || !myTeam) return null;
  const total = myTeam.spentM + myTeam.budgetM;
  const swap = (slotA: string, slotB: string) => void run('swap', () => post(`${base}/lineup/swap`, { slotA, slotB }));
  const locked = auction.phase === 'complete' && ctx.snap.game.status !== 'auction_complete';

  return (
    <Card className={className}>
      <CardTitle action={<Pill>{mine.formation}</Pill>}>My team</CardTitle>
      <PitchView formation={mine.formation} slots={myTeam.slots} playersById={playersById} onSwap={locked ? undefined : swap} />
      <p className="mt-2 text-xs text-white/45">Tap a player, then a highlighted slot, to swap. On a computer you can also drag.</p>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-white/60">
          <span>Spent {money(myTeam.spentM)}</span>
          <span>{money(myTeam.budgetM)} left</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/10" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={myTeam.spentM} aria-label="Budget spent">
          <div className="h-full rounded-full bg-gradient-to-r from-pitch-500 to-gold-400" style={{ width: `${total ? (myTeam.spentM / total) * 100 : 0}%` }} />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Slots left" value={String(11 - myTeam.filled)} />
        <Stat label="Max bid" value={auction.phase === 'complete' ? '—' : money(myTeam.maxBidM)} />
        <Stat label="Avg overall" value={myTeam.averageOverall === null ? '—' : String(myTeam.averageOverall)} />
      </dl>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-night-950/50 px-2 py-2 ring-1 ring-white/5">
      <dt className="text-[0.65rem] uppercase tracking-wide text-white/50">{label}</dt>
      <dd className="font-display text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
