import { useState } from 'react';
import { Button, Card, CardTitle, cx, Pill } from '../../components/ui';
import { TeamBadge } from '../../components/team';
import { money } from '../../lib/format';
import { PitchView } from './TeamPitch';
import { Positions, StarButton, TeamTag, TierBadge, type RoomCtx } from './parts';

export function RivalsPanel({ ctx, className }: { ctx: RoomCtx; className?: string }) {
  const { auction, teamsById, mine } = ctx;
  const [open, setOpen] = useState<string | null>(null);
  const lot = auction.lot;
  return (
    <Card className={className}>
      <CardTitle>Teams</CardTitle>
      <ul className="flex flex-col gap-2">
        {auction.teams.map((t) => {
          const p = teamsById.get(t.participantId);
          if (!p) return null;
          const elig = lot?.eligibility[t.participantId];
          const expanded = open === t.participantId;
          return (
            <li key={t.participantId} className={cx('rounded-xl bg-night-950/50 ring-1', p.id === mine?.id ? 'ring-pitch-400/40' : 'ring-white/5')}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : t.participantId)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-3 px-3 py-2 text-left"
              >
                <TeamBadge color={p.color} monogram={p.monogram} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate font-semibold">
                    {p.teamName}
                    {p.id === mine?.id && <span className="text-xs text-pitch-400">(you)</span>}
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-white/55">
                    <span className={cx('size-1.5 rounded-full', p.isConnected ? 'bg-pitch-400' : 'bg-red-400')} aria-hidden="true" />
                    <span className="truncate">{p.managerName}</span>
                    {p.control === 'bot' && !p.isBot && <Pill tone="gold">Bot in charge</Pill>}
                    {p.control === 'auto' && <Pill tone="gold">Auto-nominate</Pill>}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p className="font-display text-base text-white tabular-nums">{money(t.budgetM)}</p>
                  <p className="text-white/50">{t.filled}/11 · max {money(t.maxBidM)}</p>
                </div>
              </button>
              {lot && elig && (
                <p className={cx('px-3 pb-2 text-xs', elig.ok ? 'text-pitch-400' : 'text-white/40')}>
                  {lot.leaderId === t.participantId
                    ? 'Leading this lot'
                    : elig.ok
                      ? `Can bid up to ${money(elig.maxBidM)} on this player`
                      : elig.code === 'TEAM_FULL'
                        ? 'XI complete'
                        : elig.code === 'NO_SLOT'
                          ? 'No slot for this player'
                          : 'Cannot bid on this player'}
                </p>
              )}
              {expanded && (
                <div className="px-3 pb-3">
                  <PitchView formation={p.formation} slots={t.slots} playersById={ctx.playersById} size="sm" />
                  <ul className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                    {t.slots
                      .filter((s) => s.playerId)
                      .map((s) => {
                        const pl = ctx.playersById.get(s.playerId!)!;
                        return (
                          <li key={s.key} className="flex items-center justify-between gap-2">
                            <span className="truncate">
                              <span className="text-white/45">{s.key}</span> {pl.name} <span className="text-white/45">{pl.overall}</span>
                              {s.outOfPosition && <span className="ml-1 text-sky-400">ALT</span>}
                            </span>
                            <span className="font-display text-gold">{money(s.priceM ?? 0)}</span>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function FeedPanel({ ctx, className }: { ctx: RoomCtx; className?: string }) {
  const { auction, teamsById, playersById } = ctx;
  const sales = [...auction.sales].reverse();
  const lot = auction.lot;
  return (
    <Card className={className}>
      <CardTitle action={<Pill>{auction.sales.length} sold</Pill>}>Sales log</CardTitle>
      <ol className="flex flex-col gap-1.5" aria-live="polite">
        {lot && (
          <li className="flex items-center gap-2 rounded-xl bg-gold-400/10 px-3 py-2 text-sm ring-1 ring-gold-400/25">
            <Pill tone="gold">Live</Pill>
            <span className="min-w-0 flex-1 truncate">
              {playersById.get(lot.playerId)?.name} nominated by {teamsById.get(lot.nominatorId)?.teamName}
            </span>
            <span className="font-display text-gold">{money(lot.currentBidM)}</span>
          </li>
        )}
        {sales.length === 0 && !lot && <li className="py-6 text-center text-sm text-white/45">No sales yet.</li>}
        {sales.map((s) => {
          const p = playersById.get(s.playerId);
          return (
            <li key={`${s.sequence ?? 'fill'}-${s.playerId}`} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm odd:bg-night-950/40">
              {p && <TierBadge overall={p.overall} size="sm" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p?.name}</p>
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-white/55">
                  <TeamTag team={teamsById.get(s.participantId)} />
                  {s.sequence !== null && <span>Lot {s.sequence}</span>}
                  {s.autoNominated && <Pill tone="gold">Auto-nominated</Pill>}
                  {s.autoFilled && <Pill>Auto-filled</Pill>}
                </p>
              </div>
              <span className="font-display text-gold tabular-nums">{money(s.priceM)}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function WatchlistPanel({ ctx, className }: { ctx: RoomCtx; className?: string }) {
  const { playersById, teamsById, mine, auction, buy } = ctx;
  const ids = [...ctx.watch].filter((id) => playersById.has(id));
  const myTurn = !!mine && auction.phase === 'nominating' && auction.nominatorId === mine.id && !auction.paused;
  return (
    <Card className={className}>
      <CardTitle action={<Pill>{ids.length}</Pill>}>Watchlist</CardTitle>
      {!mine && <p className="text-sm text-white/50">Join a game to keep a watchlist.</p>}
      {mine && ids.length === 0 && <p className="py-6 text-center text-sm text-white/45">Star players in the pool to follow them here. You get an alert when one goes up for auction.</p>}
      <ul className="flex flex-col divide-y divide-white/5">
        {ids.map((id) => {
          const p = playersById.get(id)!;
          const lost = p.status === 'sold' && p.soldTo !== mine?.id;
          const mineBought = p.status === 'sold' && p.soldTo === mine?.id;
          return (
            <li key={id} className={cx('flex items-center gap-3 py-2', p.status === 'live' && 'rounded-xl bg-gold-400/10 px-2 ring-1 ring-gold-400/30')}>
              <TierBadge overall={p.overall} size="md" />
              <div className="min-w-0 flex-1">
                <p className={cx('truncate font-semibold', lost && 'text-white/45 line-through decoration-red-400 decoration-2')}>{p.name}</p>
                <Positions player={p} />
                <p className="mt-0.5 text-xs text-white/55">
                  {p.status === 'live'
                    ? 'Up for auction now'
                    : lost
                      ? `Bought by ${teamsById.get(p.soldTo ?? '')?.teamName ?? 'a rival'} for ${money(p.priceM ?? 0)}`
                      : mineBought
                        ? `Yours for ${money(p.priceM ?? 0)}`
                        : p.status === 'unsold'
                          ? 'Unsold'
                          : `Base ${money(p.basePriceM)}`}
                </p>
              </div>
              {p.status === 'live' && <Pill tone="gold">Live</Pill>}
              {mineBought && <Pill tone="green">Yours</Pill>}
              {myTurn && p.status === 'available' && (
                <Button size="sm" disabled={!buy?.get(id)?.ok} onClick={() => ctx.openNominate(id)}>
                  Nominate
                </Button>
              )}
              <StarButton on onClick={() => ctx.toggleWatch(id)} label={p.name} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
