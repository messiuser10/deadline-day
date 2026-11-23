import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

const isTyping = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);

/**
 * The auction pool with search, position chips and filters. Keyboard: / focuses the search, the arrow keys
 * (and Home, End, Page Up, Page Down) move through the players, Enter nominates on your turn, W stars.
 * `bare` drops the card chrome for use inside the phone bottom sheet.
 */
export function PoolPanel({ ctx, className, bare = false }: { ctx: RoomCtx; className?: string; bare?: boolean }) {
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

  // Roving focus over the rows: one row is in the tab order, the arrow keys move between them.
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const activeIndex = Math.min(active, Math.max(0, list.length - 1));
  useEffect(() => {
    if (bare) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bare]);
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-pool-row]') ?? [])];
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-pool-row]');
    const i = row ? rows.indexOf(row) : -1;
    if (i < 0) return;
    const page = 8;
    const to =
      e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : e.key === 'PageDown' ? i + page : e.key === 'PageUp' ? i - page : null;
    if (to !== null) {
      e.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, to));
      setActive(next);
      rows[next]?.focus();
      return;
    }
    if (e.target !== row) return; // keys on the row's own buttons keep their normal meaning
    const p = list[i];
    if (!p) return;
    if (e.key === 'Enter' && myTurn && p.status === 'available' && buy?.get(p.id)?.ok) {
      e.preventDefault();
      ctx.openNominate(p.id);
    } else if ((e.key === 'w' || e.key === 'W') && mine) {
      e.preventDefault();
      ctx.toggleWatch(p.id);
    }
  };

  const Shell = bare ? 'div' : Card;
  return (
    <Shell className={cx('flex flex-col', className)} id={bare ? undefined : 'pool-panel'}>
      {!bare && <CardTitle action={<Pill>{available} available</Pill>}>Pool</CardTitle>}
      {myTurn && <p className="mb-3 rounded-xl bg-pitch-500/15 px-3 py-2 text-sm text-pitch-400 ring-1 ring-pitch-400/30">Your turn: tap Nominate on a player you can buy.</p>}

      <div className="flex flex-col gap-2">
        <Input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players or clubs" aria-label="Search players" aria-keyshortcuts="/" />
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Positions (main or alternate)">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => toggleGroup(g)}
              aria-pressed={groups.has(g)}
              className={cx(
                'min-h-10 min-w-12 shrink-0 rounded-full px-3 text-xs font-bold ring-1 ring-inset transition focus-visible:outline-2 focus-visible:outline-pitch-400',
                groups.has(g) ? 'bg-pitch-500 text-ink ring-pitch-500' : 'bg-night-950/50 text-white/70 ring-white/10 hover:text-white',
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

      <p className="mt-3 hidden text-xs text-white/40 lg:block" id="pool-keys">
        Keyboard: <kbd className="font-sans">/</kbd> search · <kbd className="font-sans">↑ ↓</kbd> move · <kbd className="font-sans">Enter</kbd> nominate · <kbd className="font-sans">W</kbd> star
      </p>
      <ul ref={listRef} onKeyDown={onListKey} className="mt-2 flex flex-col divide-y divide-white/5" aria-label="Players" aria-describedby="pool-keys">
        {list.length === 0 && <li className="py-8 text-center text-sm text-white/45">No players match these filters.</li>}
        {list.map((p, i) => (
          <PoolRow key={p.id} p={p} ctx={ctx} myTurn={myTurn} focusable={i === activeIndex} onFocus={() => setActive(i)} />
        ))}
      </ul>
    </Shell>
  );
}

function PoolRow({ p, ctx, myTurn, focusable, onFocus }: { p: AuctionPlayerView; ctx: RoomCtx; myTurn: boolean; focusable: boolean; onFocus: () => void }) {
  const { mine, buy, teamsById, watch } = ctx;
  const done = p.status === 'sold' || p.status === 'unsold';
  const b = buy?.get(p.id);
  const starred = watch.has(p.id);
  const lostToRival = starred && p.status === 'sold' && p.soldTo !== mine?.id;
  const state = p.status === 'sold' ? `sold for ${money(p.priceM ?? 0)}` : p.status === 'unsold' ? 'unsold' : p.status === 'live' ? 'on the block now' : `base ${money(p.basePriceM)}`;
  return (
    <li
      data-pool-row
      tabIndex={focusable ? 0 : -1}
      onFocus={(e) => e.target === e.currentTarget && onFocus()}
      aria-label={`${p.name}, ${p.position}, overall ${p.overall}, ${state}${starred ? ', starred' : ''}`}
      className={cx('-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 outline-none focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-pitch-400', done && 'opacity-55')}
    >
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
            <span className="font-display text-gold">{money(p.priceM ?? 0)}</span>
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
          <Button size="sm" className="min-h-10" disabled={!b?.ok} onClick={() => ctx.openNominate(p.id)} title={b?.reason ?? undefined} tabIndex={focusable ? 0 : -1}>
            Nominate
          </Button>
        )}
        {mine && <StarButton on={starred} onClick={() => ctx.toggleWatch(p.id)} label={p.name} tabIndex={focusable ? 0 : -1} />}
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
