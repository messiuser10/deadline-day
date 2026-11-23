import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AdminGameDetail, AdminGamesPage, GameStatus } from '@deadline-day/protocol';
import { del, get, post, put } from '../../lib/api';
import { money } from '../../lib/format';
import { Button, Card, CardTitle, cx, Input, LinkButton, Pill, Skeleton } from '../../components/ui';
import { AdminHeader, age, ConfirmButton, dateTime, DownloadLink, EmptyRow, gameHref, NumberInput, Select, STATUS_LABEL, useAdminMutation } from './parts';

type Filter = 'active' | 'all' | 'test' | GameStatus;

const STATUS_TONE: Partial<Record<GameStatus, 'green' | 'gold' | 'red'>> = { auctioning: 'green', paused: 'gold', simulating: 'green', cancelled: 'red' };

export function StatusPill({ status }: { status: GameStatus }) {
  return <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status]}</Pill>;
}

export function GamesTab() {
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const list = useInfiniteQuery({
    queryKey: ['admin', 'games', filter, q],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      if (q) params.set('q', q);
      if (pageParam) params.set('before', String(pageParam));
      return get<AdminGamesPage>(`/api/admin/games?${params}`);
    },
    getNextPageParam: (last) => last.nextBefore,
    refetchInterval: 15_000,
  });
  const rows = list.data?.pages.flatMap((p) => p.games) ?? [];
  const now = Date.now();
  return (
    <>
      <AdminHeader title="Games" description="Every game on the server. Open one to watch it or step in as host." />
      <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
        <Input aria-label="Search games" placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label="Status" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-36">
          <option value="active">In progress</option>
          <option value="all">All games</option>
          <option value="lobby">Lobby</option>
          <option value="auctioning">Auction</option>
          <option value="paused">Paused</option>
          <option value="auction_complete">Reveal</option>
          <option value="simulating">Season</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="test">Test games</option>
        </Select>
      </div>
      <Card className="!p-0 sm:!p-0">
        {list.isPending ? (
          <Skeleton className="m-4 h-60" />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyRow>No games match.</EmptyRow>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {rows.map((g) => (
              <li key={g.id}>
                <Link to={`/admin/games/${g.code}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 sm:px-4">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{g.name}</span>
                      {g.isTest && <Pill tone="gold">test</Pill>}
                    </span>
                    <span className="block truncate text-xs text-white/45">
                      <span className="font-mono">{g.code}</span> · host {g.host?.displayName ?? 'deleted user'} · {g.humans} human{g.humans === 1 ? '' : 's'}, {g.bots} bot{g.bots === 1 ? '' : 's'}
                      {g.seasons > 0 && ` · ${g.seasons} season${g.seasons === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-white/45 sm:block" title={dateTime(g.createdAt)}>
                    {age(g.createdAt, now)} old
                  </span>
                  <span className="w-24 shrink-0 text-right">
                    <StatusPill status={g.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {list.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

function OrderEditor({ detail }: { detail: AdminGameDetail }) {
  const code = detail.game.code;
  const [order, setOrder] = useState(detail.order);
  useEffect(() => setOrder(detail.order), [detail.order]);
  const names = new Map(detail.teams.map((t) => [t.id, t.teamName]));
  const dirty = order.join() !== detail.order.join();
  const save = useAdminMutation(() => put(`/api/admin/games/${code}/order`, { order }), { invalidate: [['admin', 'game', code]], success: 'Nomination order saved' });
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
  };
  return (
    <Card>
      <CardTitle
        action={
          <span className="flex gap-2">
            {dirty && (
              <Button size="sm" variant="ghost" onClick={() => setOrder(detail.order)}>
                Undo
              </Button>
            )}
            <Button size="sm" onClick={() => save.mutate(undefined)} disabled={!dirty} loading={save.isPending}>
              Save order
            </Button>
          </span>
        }
      >
        Nomination order
      </CardTitle>
      {detail.game.status !== 'lobby' && <p className="mb-2 text-xs text-white/50">Mid-auction, the team on the clock keeps its turn; the new order takes over from there.</p>}
      <ol className="flex flex-col gap-1">
        {order.map((id, i) => (
          <li key={id} className={cx('flex items-center gap-2 rounded-xl px-2 py-1.5 ring-1 ring-inset', id === detail.onTheClock ? 'bg-pitch-500/10 ring-pitch-500/40' : 'ring-white/5')}>
            <span className="w-5 text-right text-xs tabular-nums text-white/45">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {names.get(id) ?? id}
              {id === detail.onTheClock && <span className="ml-2 text-xs text-pitch-400">on the clock</span>}
            </span>
            <button type="button" aria-label={`Move ${names.get(id)} up`} disabled={i === 0} onClick={() => move(i, -1)} className="grid size-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-25">
              ↑
            </button>
            <button type="button" aria-label={`Move ${names.get(id)} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)} className="grid size-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-25">
              ↓
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function GameDetailPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const key = ['admin', 'game', code];
  const q = useQuery({ queryKey: key, queryFn: async () => (await get<{ detail: AdminGameDetail }>(`/api/admin/games/${code}`)).detail, refetchInterval: 5000 });
  const [seed, setSeed] = useState<number | null>(null);
  const inval = { invalidate: [key, ['admin', 'games']] };
  const host = useAdminMutation(({ path, body }: { path: string; body?: unknown }) => post(`/api/games/${code}${path}`, body ?? {}), inval);
  const control = useAdminMutation(({ pid, mode }: { pid: string; mode: 'bot' | 'human' }) => post(`/api/games/${code}/participants/${pid}/control`, { mode }), { ...inval, success: 'Control changed' });
  const changeSeed = useAdminMutation((s: number | null) => post<{ seed: number }>(`/api/admin/games/${code}/seed`, s === null ? {} : { seed: s }), {
    ...inval,
    success: (r) => `Seed is now ${r.seed}`,
    onSuccess: () => setSeed(null),
  });
  const remove = useAdminMutation(() => del(`/api/admin/games/${code}`), { invalidate: [['admin', 'games']], success: 'Game deleted', onSuccess: () => void navigate('/admin/games') });

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) {
    return (
      <Card>
        <p className="text-sm text-white/70">That game does not exist (it may have been deleted).</p>
        <LinkButton to="/admin/games" variant="secondary" size="sm" className="mt-3">
          All games
        </LinkButton>
      </Card>
    );
  }
  const { game, teams } = q.data;
  const s = game.status;
  const live = s === 'auctioning' || s === 'paused';
  const act = (label: string, path: string) => (
    <Button size="sm" variant="secondary" loading={host.isPending && host.variables?.path === path} onClick={() => host.mutate({ path })}>
      {label}
    </Button>
  );

  return (
    <>
      <AdminHeader
        title={game.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{game.code}</span>
            <StatusPill status={s} />
            {game.isTest && <Pill tone="gold">test</Pill>}
            <span>
              host {game.host?.displayName ?? 'deleted user'} · {game.visibility} · created {dateTime(game.createdAt)}
            </span>
          </span>
        }
        actions={
          <>
            <LinkButton to="/admin/games" size="sm" variant="ghost">
              All games
            </LinkButton>
            <LinkButton to={gameHref(s, game.code)} size="sm">
              Open as spectator
            </LinkButton>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Controls</CardTitle>
          <div className="flex flex-col gap-3">
            {s === 'lobby' && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => host.mutate({ path: '/start', body: { force: true } })} loading={host.isPending}>
                  Force start
                </Button>
              </div>
            )}
            {live && (
              <>
                <div className="flex flex-wrap gap-2">
                  {s === 'paused' ? act('Resume', '/auction/resume') : act('Pause', '/auction/pause')}
                  {act('Skip nomination', '/auction/skip')}
                  {act('Extend timer +10 s', '/auction/extend')}
                  {act('Undo last sale', '/auction/undo')}
                </div>
                <div className="flex flex-wrap gap-2">
                  <ConfirmButton label="Force complete (auto-fill)" confirm="Tap again to auto-fill every slot" onConfirm={() => host.mutate({ path: '/auction/end' })} />
                  <ConfirmButton label="Reset auction" confirm="Tap again: cancel every purchase" onConfirm={() => host.mutate({ path: '/auction/reset' })} />
                </div>
              </>
            )}
            {(s === 'simulating' || s === 'completed') && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => host.mutate({ path: '/season/rerun' })} loading={host.isPending && host.variables?.path === '/season/rerun'}>
                  Re-run simulation
                </Button>
              </div>
            )}
            {s !== 'lobby' && s !== 'cancelled' && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-white/70">
                    Seed <span className="font-mono text-white/50">{game.seed ?? '–'}</span>
                  </span>
                  <NumberInput aria-label="New seed" value={seed} min={0} max={4294967295} placeholder="random" onChange={setSeed} className="w-40" />
                </label>
                <Button size="sm" variant="secondary" disabled={s === 'simulating'} onClick={() => changeSeed.mutate(seed)} loading={changeSeed.isPending}>
                  Change seed
                </Button>
              </div>
            )}
            {s !== 'lobby' && s !== 'cancelled' && <p className="text-xs text-white/45">A new seed applies to the next season, Expected Strength and multi-season runs. Played seasons keep theirs.</p>}
            <div className="flex flex-wrap gap-2 border-t border-white/5 pt-3">
              {(s === 'simulating' || s === 'completed') && (
                <>
                  <DownloadLink href={`/api/games/${game.code}/export?format=csv&table=table`}>Table CSV</DownloadLink>
                  <DownloadLink href={`/api/games/${game.code}/export?format=json&table=fixtures`}>Fixtures JSON</DownloadLink>
                </>
              )}
              {(s === 'lobby' || live) && <ConfirmButton label="Cancel game" confirm="Tap again to cancel" onConfirm={() => host.mutate({ path: '/cancel' })} />}
              <ConfirmButton label="Delete game" confirm="Tap again: delete everything" onConfirm={() => remove.mutate(undefined)} loading={remove.isPending} />
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Teams ({teams.length})</CardTitle>
          <ul className="flex flex-col divide-y divide-white/5">
            {teams.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2">
                <span className={cx('size-2 shrink-0 rounded-full', t.isBot ? 'bg-white/30' : t.isConnected ? 'bg-pitch-400' : 'bg-red-400')} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{t.teamName}</span>
                  <span className="block truncate text-xs text-white/45">
                    {t.isBot ? 'Bot' : `${t.manager ?? 'Deleted user'} · ${t.isConnected ? 'online' : 'offline'}`}
                    {!t.isBot && t.control !== 'human' && ` · ${t.control === 'bot' ? 'bot playing' : 'auto-nominate'}`} · {t.players} players · {money(t.budgetRemainingM)}
                  </span>
                </span>
                {!t.isBot && live && (
                  <Button size="sm" variant="secondary" onClick={() => control.mutate({ pid: t.id, mode: t.control === 'human' ? 'bot' : 'human' })} loading={control.isPending && control.variables?.pid === t.id}>
                    {t.control === 'human' ? 'Replace with bot' : 'Give back'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
        {(s === 'lobby' || live) && <OrderEditor detail={q.data} />}
      </div>
    </>
  );
}
