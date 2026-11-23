import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { LeaderboardView } from '@deadline-day/protocol';
import { get } from '../lib/api';
import { useMe } from '../lib/auth';
import { Card, cx, LinkButton, Skeleton } from '../components/ui';
import { GradeChip } from './history/parts';

/** /leaderboard: registered players ranked by titles, then average finish. */
export function LeaderboardPage() {
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['leaderboard'],
    queryFn: async () => (await get<{ leaderboard: LeaderboardView }>('/api/leaderboard')).leaderboard,
    staleTime: 30_000,
  });

  return (
    <main className="mx-auto w-full max-w-4xl px-3 pb-16 pt-4 sm:px-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-pitch-400">All games</p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Leaderboard</h1>
          <p className="text-sm text-white/60">Ranked by league titles, then by average finish. First seasons only; guests are not ranked.</p>
        </div>
        <LinkButton to="/hall-of-fame" variant="secondary" size="sm">
          Hall of Fame
        </LinkButton>
      </header>
      <Card>
        {q.isPending ? (
          <Skeleton className="h-80" />
        ) : q.isError || !q.data ? (
          <p className="py-6 text-center text-sm text-red-300">Could not load the leaderboard. Reload to try again.</p>
        ) : q.data.rows.length === 0 ? (
          <p className="rounded-xl bg-night-950/40 px-4 py-6 text-center text-sm text-white/50">Nobody is ranked yet. Finish a game with an account to be the first.</p>
        ) : (
          <table className="w-full table-fixed text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[0.7rem] uppercase tracking-wide text-white/45">
                <th className="w-8 whitespace-nowrap py-1.5 font-medium" scope="col">
                  <span className="sr-only">Rank</span>#
                </th>
                <th className="py-1.5 font-medium" scope="col">Player</th>
                <th className="w-12 whitespace-nowrap py-1.5 text-right font-medium sm:w-20" scope="col">Games</th>
                <th className="w-12 whitespace-nowrap py-1.5 text-right font-medium sm:w-20" scope="col">Titles</th>
                <th className="hidden whitespace-nowrap py-1.5 text-right font-medium sm:table-cell sm:w-20" scope="col">Top 4</th>
                <th className="w-14 whitespace-nowrap py-1.5 text-right font-medium sm:w-28" scope="col" title="Average finish">
                  Avg
                  <span className="hidden sm:inline"> finish</span>
                </th>
                <th className="w-14 whitespace-nowrap py-1.5 text-right font-medium sm:w-28" scope="col">
                  Best<span className="hidden sm:inline"> grade</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => {
                const mine = me?.username === r.username;
                return (
                  <tr key={r.username} className={cx('border-t border-white/5', mine && 'bg-pitch-500/10')}>
                    <td className={cx('py-2 font-display text-base font-bold', r.rank === 1 ? 'text-gold' : 'text-white/60')}>{r.rank}</td>
                    <td className="py-2 pr-2">
                      <Link to={`/profile/${encodeURIComponent(r.username)}`} className="block truncate font-semibold hover:text-pitch-400">
                        {r.displayName}
                        {mine && <span className="ml-1.5 text-xs font-normal text-pitch-400">you</span>}
                      </Link>
                      <span className="block truncate text-xs text-white/45">@{r.username}</span>
                    </td>
                    <td className="py-2 text-right text-white/70">{r.games}</td>
                    <td className="py-2 text-right font-display text-base font-bold">{r.titles}</td>
                    <td className="hidden py-2 text-right text-white/70 sm:table-cell">{r.topFour}</td>
                    <td className="py-2 text-right">{r.avgFinish.toFixed(1)}</td>
                    <td className="py-2 text-right">
                      <GradeChip grade={r.bestGrade} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}
