import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { HallOfFameEntry, HallOfFameView, RecordBookView, RecordEntry } from '@deadline-day/protocol';
import { get } from '../lib/api';
import { plural } from '../lib/format';
import { ordinal } from '../lib/season';
import { useMediaQuery } from '../hooks/useClock';
import { Button, Card, CardTitle, LinkButton, Skeleton } from '../components/ui';
import { SwipeTabs } from '../components/SwipeTabs';
import { TeamBadge } from '../components/team';
import { TeamName, Trophy } from './season/parts';
import { dateOf, GameLink, GradeChip } from './history/parts';

const fetchPage = async (before: number | null) =>
  (await get<{ hallOfFame: HallOfFameView }>(`/api/hall-of-fame${before ? `?before=${before}` : ''}`)).hallOfFame;

export function useRecords() {
  return useQuery({ queryKey: ['records'], queryFn: async () => (await get<{ records: RecordBookView }>('/api/records')).records, staleTime: 60_000 });
}

/** /hall-of-fame: every finished game (newest first) and the record book. */
export function HallOfFamePage() {
  const wide = useMediaQuery('(min-width: 1024px)');
  const games = <Champions />;
  const records = <RecordBook />;
  return (
    <main className="mx-auto w-full max-w-6xl px-3 pb-16 pt-4 sm:px-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-pitch-400">History</p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Hall of Fame</h1>
          <p className="text-sm text-white/60">Every finished game, with its champion and best auction team. First seasons only.</p>
        </div>
        <LinkButton to="/leaderboard" variant="secondary" size="sm">
          Leaderboard
        </LinkButton>
      </header>
      {wide ? (
        <div className="grid items-start gap-4 lg:grid-cols-[3fr_2fr]">
          {games}
          {records}
        </div>
      ) : (
        <SwipeTabs
          label="Hall of Fame sections"
          tabs={[
            { id: 'games', label: 'Champions', content: games },
            { id: 'records', label: 'Record book', content: records },
          ]}
        />
      )}
    </main>
  );
}

function Champions() {
  const q = useInfiniteQuery({
    queryKey: ['hall-of-fame'],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
  });
  const entries = q.data?.pages.flatMap((p) => p.games) ?? [];
  return (
    <Card>
      <CardTitle>Champions</CardTitle>
      {q.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : q.isError ? (
        <p className="py-6 text-center text-sm text-red-300">Could not load the Hall of Fame. Reload to try again.</p>
      ) : entries.length === 0 ? (
        <p className="rounded-xl bg-night-950/40 px-4 py-6 text-center text-sm text-white/50">No finished games yet. Play one to the final whistle to start the Hall of Fame.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {entries.map((e, i) => (
              <li key={`${e.gameCode ?? 'private'}-${e.playedAt}-${i}`}>
                <HallEntry e={e} />
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <Button variant="secondary" className="mt-3 w-full" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              Show older games
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

/** `compact` stacks champion and best auction team, for narrow columns such as the Home sidebar. */
export function HallEntry({ e, compact = false }: { e: HallOfFameEntry; compact?: boolean }) {
  const b = e.bestAuctionTeam;
  const auctionWon = b.position === 1;
  return (
    <GameLink code={e.gameCode} className="rounded-2xl bg-night-950/50 p-3 ring-1 ring-white/5">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 truncate font-semibold">{e.gameCode ? e.gameName : 'Private game'}</span>
        <span className="text-xs text-white/50">
          {dateOf(e.playedAt)} · {plural(e.auctionTeams, 'auction team')}
        </span>
      </p>
      <div className={`mt-2 grid gap-2 ${auctionWon || compact ? '' : 'sm:grid-cols-2'}`}>
        <div className="flex min-w-0 items-center gap-2 rounded-xl bg-gold-400/10 px-3 py-2 ring-1 ring-gold-400/25">
          <Trophy className="size-5 shrink-0 text-gold-400" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-gold-400">Champions</p>
            <TeamName team={e.champion} className="text-sm" />
            <p className="truncate text-xs text-white/55">
              {e.champion.kind === 'ai' ? 'AI club' : (e.champion.managerName ?? 'Bot')} · {e.champion.points} pts
            </p>
          </div>
          {auctionWon && <GradeChip grade={b.grade} className="shrink-0" />}
        </div>
        {!auctionWon && (
          <div className="flex min-w-0 items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-white/50">Best auction team</p>
              <TeamName team={b} tag={false} className="text-sm" />
              <p className="truncate text-xs text-white/55">
                {b.managerName ?? 'Bot'} · {ordinal(b.position)}, {b.points} pts
              </p>
            </div>
            <GradeChip grade={b.grade} className="shrink-0" />
          </div>
        )}
      </div>
    </GameLink>
  );
}

const RECORDS: { key: keyof RecordBookView; title: string; unit: (v: number) => string; player: boolean }[] = [
  { key: 'mostPoints', title: 'Most points in a season', unit: (v) => `${v} pts`, player: false },
  { key: 'mostGoalsByBoughtPlayer', title: 'Most goals by a bought player', unit: (v) => `${v} goals`, player: true },
  { key: 'bestGoalDifference', title: 'Best goal difference', unit: (v) => (v > 0 ? `+${v}` : String(v)), player: false },
];

function RecordBook() {
  const q = useRecords();
  return (
    <Card>
      <CardTitle>Record book</CardTitle>
      <p className="-mt-1 mb-3 text-sm text-white/55">Auction teams only, first seasons only. Private games count but stay unnamed.</p>
      {q.isPending ? (
        <Skeleton className="h-72" />
      ) : q.isError || !q.data ? (
        <p className="py-6 text-center text-sm text-red-300">Could not load the record book.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {RECORDS.map((r) => (
            <section key={r.key} aria-labelledby={`rec-${r.key}`}>
              <h3 id={`rec-${r.key}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gold-400">
                {r.title}
              </h3>
              {q.data[r.key].length === 0 ? (
                <p className="text-sm text-white/45">No record yet.</p>
              ) : (
                <ol className="flex flex-col divide-y divide-white/5">
                  {q.data[r.key].map((e, i) => (
                    <li key={`${e.gameCode}-${e.holder}-${i}`}>
                      <RecordRow rank={i + 1} e={e} value={r.unit(e.value)} player={r.player} />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

function RecordRow({ rank, e, value, player }: { rank: number; e: RecordEntry; value: string; player: boolean }) {
  return (
    <GameLink code={e.gameCode} className="flex min-h-12 items-center gap-2 py-1.5">
      <span className={`w-5 shrink-0 text-center font-display font-bold ${rank === 1 ? 'text-gold-400' : 'text-white/45'}`}>{rank}</span>
      <TeamBadge color={e.color} monogram={e.monogram} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{e.holder}</span>
        <span className="block truncate text-xs text-white/50">
          {player ? `${e.teamName} · ` : ''}
          {e.managerName ?? 'Bot'} · {e.gameCode ? e.gameName : 'Private game'}
        </span>
      </span>
      <span className="shrink-0 font-display text-lg font-bold tabular-nums">{value}</span>
    </GameLink>
  );
}
