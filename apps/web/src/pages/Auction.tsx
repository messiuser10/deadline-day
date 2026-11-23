import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuctionView, GameSnapshot, UserView } from '@deadline-day/protocol';
import { useMe } from '../lib/auth';
import { del, get, put } from '../lib/api';
import { buyability, toEngineState, type Buyability } from '../lib/auction';
import { money, plural } from '../lib/format';
import { useGame } from '../hooks/useGame';
import { useMediaQuery, useServerNow } from '../hooks/useClock';
import { toast } from '../stores/toast';
import { Button, cx, LinkButton, Skeleton } from '../components/ui';
import { ConnectionDot } from '../components/Header';
import { ChatCard } from './lobby/sections';
import { LotPanel, MobileActionBar } from './auction/LotPanel';
import { MyTeamCard } from './auction/TeamPitch';
import { NominateModal, PoolPanel } from './auction/PoolPanel';
import { FeedPanel, RivalsPanel, WatchlistPanel } from './auction/SidePanels';
import { DisconnectBanner, HostSheet, PausedBanner, ReclaimBanner, SoldOverlay } from './auction/HostTools';
import { TeamTag, type RoomCtx } from './auction/parts';

export function AuctionPage() {
  const params = useParams();
  const { code, snapshot: snap, error } = useGame(params.code ?? '');
  const { data: me } = useMe();
  const navigate = useNavigate();
  const phase = snap?.auction?.phase;

  useEffect(() => {
    if (snap?.game.status === 'lobby') void navigate(`/lobby/${code}`, { replace: true });
    else if (phase === 'complete') void navigate(`/reveal/${code}`, { replace: true });
  }, [snap?.game.status, phase, code, navigate]);

  if (error) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-4xl font-bold uppercase">Game not found</h1>
        <LinkButton to="/" className="mt-6">
          Back home
        </LinkButton>
      </main>
    );
  }
  if (!snap) {
    return (
      <main className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-6 lg:grid-cols-12">
        <Skeleton className="h-16 lg:col-span-12" />
        <Skeleton className="h-96 lg:col-span-4" />
        <Skeleton className="h-96 lg:col-span-8" />
      </main>
    );
  }
  if (!snap.auction || snap.game.status === 'cancelled') {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-4xl font-bold uppercase">{snap.game.status === 'cancelled' ? 'Game cancelled' : 'No auction yet'}</h1>
        <LinkButton to="/" className="mt-6">
          Back home
        </LinkButton>
      </main>
    );
  }
  return <AuctionRoom snap={snap} auction={snap.auction} me={me} />;
}

type Tab = 'team' | 'pool' | 'teams' | 'log' | 'watch' | 'chat';

function AuctionRoom({ snap, auction, me }: { snap: GameSnapshot; auction: AuctionView; me: UserView | null | undefined }) {
  const code = snap.game.code;
  const base = `/api/games/${code}`;
  const now = useServerNow(200);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [tab, setTab] = useState<Tab>('pool');
  const [nominating, setNominating] = useState<string | null>(null);
  const [hostOpen, setHostOpen] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const mine = snap.participants.find((p) => p.userId !== null && p.userId === me?.id);
  const myTeam = mine ? auction.teams.find((t) => t.participantId === mine.id) : undefined;
  const canHost = !!me && (snap.game.hostUserId === me.id || me.role === 'admin');
  const teamsById = useMemo(() => new Map(snap.participants.map((p) => [p.id, p])), [snap.participants]);
  const playersById = useMemo(() => new Map(auction.players.map((p) => [p.id, p])), [auction.players]);

  // Engine preview of what I can buy; the market only changes on nominations and sales, not on bids.
  const marketKey = `${mine?.id}|${auction.lot?.id ?? ''}|${auction.sales.length}|${auction.bought}|${auction.teams.map((t) => t.budgetM).join(',')}`;
  const buyCache = useRef<{ key: string; value: Map<string, Buyability> | null }>({ key: '', value: null });
  if (buyCache.current.key !== marketKey) {
    buyCache.current = { key: marketKey, value: mine ? buyability(toEngineState(auction, snap.participants), mine.id) : null };
  }
  const buy = buyCache.current.value;

  const watchKey = ['watchlist', code];
  const watchQuery = useQuery({ queryKey: watchKey, queryFn: () => get<{ playerIds: string[] }>(`${base}/watchlist`), enabled: !!mine });
  const watch = useMemo(() => new Set(watchQuery.data?.playerIds ?? []), [watchQuery.data]);
  const toggleWatch = (playerId: string) => {
    const on = !watch.has(playerId);
    const prev = watchQuery.data?.playerIds ?? [];
    queryClient.setQueryData(watchKey, { playerIds: on ? [...prev, playerId] : prev.filter((id) => id !== playerId) });
    (on ? put<{ playerIds: string[] }>(`${base}/watchlist/${playerId}`) : del<{ playerIds: string[] }>(`${base}/watchlist/${playerId}`))
      .then((res) => queryClient.setQueryData(watchKey, res))
      .catch(() => {
        queryClient.setQueryData(watchKey, { playerIds: prev });
        toast('Could not update your watchlist', 'error');
      });
  };

  // Alert when a starred player goes up for auction.
  const alerted = useRef<string | null>(null);
  const lot = auction.lot;
  useEffect(() => {
    if (!lot || alerted.current === lot.id) return;
    alerted.current = lot.id;
    if (watch.has(lot.playerId) && lot.nominatorId !== mine?.id) {
      toast(`★ ${playersById.get(lot.playerId)?.name ?? 'A watched player'} is up for auction`, 'success');
      navigator.vibrate?.([60, 40, 60]);
    }
  }, [lot, watch, mine?.id, playersById]);

  const ctx: RoomCtx = {
    snap,
    auction,
    me,
    mine,
    myTeam,
    canHost,
    base,
    teamsById,
    playersById,
    buy,
    watch,
    toggleWatch,
    openNominate: setNominating,
  };

  const myTurn = !!mine && auction.phase === 'nominating' && auction.nominatorId === mine.id;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    ...(isDesktop || !mine ? [] : [{ id: 'team' as const, label: 'My team' }]),
    { id: 'pool', label: 'Pool' },
    { id: 'teams', label: 'Teams' },
    { id: 'log', label: 'Sales', badge: auction.sales.length },
    ...(mine ? [{ id: 'watch' as const, label: 'Watchlist', badge: watch.size }] : []),
    { id: 'chat', label: 'Chat' },
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : 'pool';

  const goToPool = () => {
    setTab('pool');
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const nominator = auction.nominatorId ? teamsById.get(auction.nominatorId) : undefined;
  const progress = auction.totalSlots ? (auction.bought / auction.totalSlots) * 100 : 0;

  return (
    <main className={cx('mx-auto w-full max-w-7xl px-3 pt-3 sm:px-4 lg:pb-10', mine ? 'pb-40' : 'pb-12')}>
      <header className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-3 text-xs uppercase tracking-[0.25em] text-pitch-400">
            Live auction <ConnectionDot />
          </p>
          <h1 className="truncate font-display text-2xl font-bold uppercase tracking-tight sm:text-3xl">{snap.game.name}</h1>
        </div>
        <div className="order-3 w-full sm:order-none sm:w-48">
          <div className="flex justify-between text-xs text-white/60">
            <span>Bought</span>
            <span className="tabular-nums">
              {auction.bought}/{auction.totalSlots}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-pitch-400 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
        {canHost && (
          <Button variant="secondary" size="sm" onClick={() => setHostOpen(true)}>
            Host controls
          </Button>
        )}
      </header>

      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-white/70">
        {auction.phase === 'nominating' ? (
          <>
            <span className="text-white/50">Nominating:</span>
            {myTurn ? <span className="font-semibold text-pitch-400">You</span> : <TeamTag team={nominator} />}
          </>
        ) : lot ? (
          <>
            <span className="text-white/50">Lot {lot.sequence}:</span>
            <span className="font-semibold">{playersById.get(lot.playerId)?.name}</span>
            <span className="text-white/50">at</span>
            <span className="font-display text-gold-400">{money(lot.currentBidM)}</span>
          </>
        ) : null}
        {myTeam && (
          <span className="ml-auto text-white/55">
            {money(myTeam.budgetM)} left · {plural(11 - myTeam.filled, 'slot')} open
          </span>
        )}
      </p>

      <div className="mb-3 flex flex-col gap-2 empty:hidden">
        <PausedBanner ctx={ctx} />
        <ReclaimBanner ctx={ctx} />
        <DisconnectBanner ctx={ctx} now={now} onOpen={() => setHostOpen(true)} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12 [&>*]:min-w-0">
        <div className="flex flex-col gap-4 lg:sticky lg:top-[4.25rem] lg:col-span-5 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:pb-2 xl:col-span-4 [&>*]:shrink-0">
          <LotPanel ctx={ctx} now={now} />
          {isDesktop && <MyTeamCard ctx={ctx} />}
        </div>

        <div className="lg:col-span-7 xl:col-span-8">
          <div ref={tabsRef} className="sticky top-14 z-20 -mx-3 mb-3 bg-night-900/90 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4 lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <div role="tablist" aria-label="Auction panels" className="flex gap-1 overflow-x-auto rounded-xl bg-night-950/70 p-1 ring-1 ring-inset ring-white/10">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active === t.id}
                  onClick={() => setTab(t.id)}
                  className={cx(
                    'flex min-h-10 shrink-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition',
                    active === t.id ? 'bg-pitch-500 text-night-950' : 'text-white/70 hover:text-white',
                  )}
                >
                  {t.label}
                  {!!t.badge && <span className={cx('rounded-full px-1.5 text-[0.7rem]', active === t.id ? 'bg-night-950/20' : 'bg-white/10')}>{t.badge}</span>}
                </button>
              ))}
            </div>
          </div>
          <div role="tabpanel">
            {active === 'team' && <MyTeamCard ctx={ctx} />}
            {active === 'pool' && <PoolPanel ctx={ctx} />}
            {active === 'teams' && <RivalsPanel ctx={ctx} />}
            {active === 'log' && <FeedPanel ctx={ctx} />}
            {active === 'watch' && <WatchlistPanel ctx={ctx} />}
            {active === 'chat' && <ChatCard ctx={{ snap, me, mine, base }} />}
          </div>
        </div>
      </div>

      <MobileActionBar ctx={ctx} now={now} onPickPlayer={goToPool} />
      <NominateModal ctx={ctx} playerId={nominating} onClose={() => setNominating(null)} />
      {canHost && <HostSheet ctx={ctx} open={hostOpen} onClose={() => setHostOpen(false)} />}
      <SoldOverlay ctx={ctx} />
    </main>
  );
}
