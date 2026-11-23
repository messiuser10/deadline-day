import { useMemo, useState } from 'react';
import { GROUPS, type Group } from '@deadline-day/engine';
import type { AuctionPlayerView } from '@deadline-day/protocol';
import { Button, Card, CardTitle, cx, Input, Modal, Pill, Toggle } from '../../components/ui';
import { useAction } from '../../hooks/useAction';
import { post } from '../../lib/api';
import { money } from '../../lib/format';
import { Positions, StarButton, TeamTag, TierBadge, type RoomCtx } from './parts';

type SortKey = 'overall' | 'base' | 'value' | 'name';
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'overall', label: 'Overall' },
  { value: 'base', label: 'Base price' },
  { value: 'value', label: 'Market value' },
  { value: 'name', label: 'Name' },
];
const MIN_OVERALLS = [0, 75, 78, 80, 82, 85, 88];

const selectClass =
  'min-h-11 rounded-xl bg-night-950/70 px-3 text-base ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-2 focus:ring-pitch-400 sm:text-sm';

export function PoolPanel({ ctx, className }: { ctx: RoomCtx; className?: string }) {
  const { auction, mine, buy } = ctx;
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<Set<Group>>(new Set());
  const [sort, setSort] = useState<SortKey>('overall');
  const [minOverall, setMinOverall] = useState(0);
  const [maxPrice, setMaxPrice] = useState('');
  const [club, setClub] = useState('');
  const [canBuyOnly, setCanBuyOnly] = useState(false);
  const [hideSold, setHideSold] = useState(false);
  const [more, setMore] = useState(false);

  const clubs = useMemo(
    () => [...new Set(auction.players.map((p) => p.clubNow).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [auction.players],
  );

  const myTurn = !!mine && auction.phase === 'nominating' && auction.nominatorId === mine.id && !auction.paused;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cap = Number(maxPrice);
    const rows = auction.players.filter((p) => {
      if (needle && !p.name.toLowerCase().includes(needle) && !(p.clubNow ?? '').toLowerCase().includes(needle)) return false;
      if (groups.size && !groups.has(p.position) && !p.altPositions.some((g) => groups.has(g))) return false;
      if (p.overall < minOverall) return false;
      if (maxPrice && Number.isFinite(cap) && p.basePriceM > cap) return false;
      if (club && p.clubNow !== club) return false;
      if (hideSold && (p.status === 'sold' || p.status === 'unsold')) return false;
      if (canBuyOnly && !buy?.get(p.id)?.ok) return false;
      return true;
    });
    const by: Record<SortKey, (a: AuctionPlayerView, b: AuctionPlayerView) => number> = {
      overall: (a, b) => b.overall - a.overall || a.positionRank - b.positionRank,
      base: (a, b) => a.basePriceM - b.basePriceM || b.overall - a.overall,
      value: (a, b) => b.marketValueM - a.marketValueM || b.overall - a.overall,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    // Sold and unsold players sink below the ones still on the market.
    const rank = (p: AuctionPlayerView) => (p.status === 'live' ? 0 : p.status === 'available' ? 1 : 2);
    return rows.sort((a, b) => rank(a) - rank(b) || by[sort](a, b));
  }, [auction.players, q, groups, minOverall, maxPrice, club, hideSold, canBuyOnly, buy, sort]);

  const toggleGroup = (g: Group) =>
    setGroups((cur) => {
      const next = new Set(cur);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const available = auction.players.filter((p) => p.status === 'available').length;

  return (
    <Card className={cx('flex flex-col', className)} id="pool-panel">
      <CardTitle action={<Pill>{available} available</Pill>}>Pool</CardTitle>
      {myTurn && <p className="mb-3 rounded-xl bg-pitch-500/15 px-3 py-2 text-sm text-pitch-400 ring-1 ring-pitch-400/30">Your turn: tap Nominate on a player you can buy.</p>}

      <div className="flex flex-col gap-2">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players or clubs" aria-label="Search players" />
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Positions (main or alternate)">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => toggleGroup(g)}
              aria-pressed={groups.has(g)}
              className={cx(
                'min-h-9 shrink-0 rounded-full px-3 text-xs font-bold ring-1 ring-inset transition',
                groups.has(g) ? 'bg-pitch-500 text-night-950 ring-pitch-500' : 'bg-night-950/50 text-white/70 ring-white/10 hover:text-white',
              )}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={cx(selectClass, 'flex-1')} aria-label="Sort by">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="md" onClick={() => setMore((v) => !v)} aria-expanded={more}>
            {more ? 'Fewer filters' : 'More filters'}
          </Button>
        </div>
        {more && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <select value={minOverall} onChange={(e) => setMinOverall(Number(e.target.value))} className={selectClass} aria-label="Minimum overall">
              {MIN_OVERALLS.map((o) => (
                <option key={o} value={o}>
                  {o ? `Overall ${o}+` : 'Any overall'}
                </option>
              ))}
            </select>
            <Input type="number" inputMode="numeric" min={0} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Max base price" aria-label="Maximum base price" />
            <select value={club} onChange={(e) => setClub(e.target.value)} className={cx(selectClass, 'col-span-2 sm:col-span-1')} aria-label="Club">
              <option value="">Any club</option>
              {clubs.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-x-4 sm:grid-cols-2">
          {mine && <Toggle checked={canBuyOnly} onChange={setCanBuyOnly} label="Only players I can buy" />}
          <Toggle checked={hideSold} onChange={setHideSold} label="Hide sold and unsold" />
        </div>
      </div>

      <ul className="mt-3 flex flex-col divide-y divide-white/5" aria-label="Players">
        {list.length === 0 && <li className="py-8 text-center text-sm text-white/45">No players match these filters.</li>}
        {list.map((p) => (
          <PoolRow key={p.id} p={p} ctx={ctx} myTurn={myTurn} />
        ))}
      </ul>
    </Card>
  );
}

function PoolRow({ p, ctx, myTurn }: { p: AuctionPlayerView; ctx: RoomCtx; myTurn: boolean }) {
  const { mine, buy, teamsById, watch } = ctx;
  const done = p.status === 'sold' || p.status === 'unsold';
  const b = buy?.get(p.id);
  const starred = watch.has(p.id);
  const lostToRival = starred && p.status === 'sold' && p.soldTo !== mine?.id;
  return (
    <li className={cx('flex items-center gap-3 py-2', done && 'opacity-55')}>
      <TierBadge overall={p.overall} size="md" />
      <div className="min-w-0 flex-1">
        <p className={cx('truncate font-semibold', lostToRival && 'line-through decoration-red-400 decoration-2')}>{p.name}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Positions player={p} />
          {p.clubNow && <span className="truncate text-xs text-white/50">{p.clubNow}</span>}
        </div>
        {p.status === 'sold' ? (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/60">
            <TeamTag team={teamsById.get(p.soldTo ?? '')} className="text-xs" />
            <span className="font-display text-gold-400">{money(p.priceM ?? 0)}</span>
            {p.autoFilled && <Pill>Auto-filled</Pill>}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-white/55">
            Base <span className="text-white/80">{money(p.basePriceM)}</span> · Value {money(p.marketValueM)}
            {b && !b.ok && p.status === 'available' && <span className="text-white/40"> · {b.reason}</span>}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {p.status === 'live' && <Pill tone="gold">Live</Pill>}
        {p.status === 'unsold' && <Pill>Unsold</Pill>}
        {myTurn && p.status === 'available' && (
          <Button size="sm" disabled={!b?.ok} onClick={() => ctx.openNominate(p.id)} title={b?.reason ?? undefined}>
            Nominate
          </Button>
        )}
        {mine && <StarButton on={starred} onClick={() => ctx.toggleWatch(p.id)} label={p.name} />}
      </div>
    </li>
  );
}

export function NominateModal({ ctx, playerId, onClose }: { ctx: RoomCtx; playerId: string | null; onClose: () => void }) {
  const player = playerId ? ctx.playersById.get(playerId) : undefined;
  const max = playerId ? (ctx.buy?.get(playerId)?.maxBidM ?? 0) : 0;
  const [amount, setAmount] = useState<number | null>(null);
  const { run, pending } = useAction();
  const value = amount ?? player?.basePriceM ?? 0;
  const close = () => {
    setAmount(null);
    onClose();
  };
  const submit = async () => {
    if (!player) return;
    const res = await run('nominate', () => post(`${ctx.base}/auction/nominate`, { playerId: player.id, openingBidM: value }));
    if (res) close();
  };
  const set = (n: number) => setAmount(Math.max(player?.basePriceM ?? 0, Math.min(max, Math.round(n))));

  return (
    <Modal open={!!player} onClose={close} title="Nominate">
      {player && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <TierBadge overall={player.overall} size="lg" showLabel />
            <div className="min-w-0">
              <p className="truncate font-display text-2xl font-bold uppercase">{player.name}</p>
              <Positions player={player} />
              <p className="mt-1 text-xs text-white/55">
                Base {money(player.basePriceM)} · Value {money(player.marketValueM)} · Your max {money(max)}
              </p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm text-white/70">Opening bid (counts as your first bid)</p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => set(value - 1)} disabled={value <= player.basePriceM} aria-label="Lower by 1">
                −
              </Button>
              <input
                type="number"
                inputMode="numeric"
                value={value}
                min={player.basePriceM}
                max={max}
                onChange={(e) => setAmount(Number(e.target.value))}
                onBlur={() => set(value)}
                aria-label="Opening bid in millions"
                className="min-h-11 min-w-0 flex-1 rounded-xl bg-night-950/70 px-3 text-center font-display text-2xl tabular-nums ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-2 focus:ring-pitch-400"
              />
              <Button variant="secondary" onClick={() => set(value + 1)} disabled={value >= max} aria-label="Raise by 1">
                +
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              <Button size="sm" variant="ghost" onClick={() => set(player.basePriceM)}>
                Base
              </Button>
              {[5, 10, 25].map((s) => (
                <Button key={s} size="sm" variant="ghost" onClick={() => set(value + s)} disabled={value + s > max}>
                  +{s}
                </Button>
              ))}
            </div>
          </div>
          <Button size="lg" onClick={() => void submit()} loading={pending === 'nominate'} disabled={value < player.basePriceM || value > max}>
            Nominate for {money(value)}
          </Button>
        </div>
      )}
    </Modal>
  );
}
