import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AdminOverview, AuditEntryView } from '@deadline-day/protocol';
import { get } from '../../lib/api';
import { Card, CardTitle, cx, Skeleton } from '../../components/ui';
import { AdminHeader, dateTime, EmptyRow, StatTile } from './parts';

export function useOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => (await get<{ overview: AdminOverview }>('/api/admin/overview')).overview,
    refetchInterval: 30_000,
  });
}

/** One audit entry in a sentence-like row; shared with the audit log tab. */
export function AuditLine({ e }: { e: AuditEntryView }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="shrink-0 text-xs tabular-nums text-white/45 sm:w-28">{dateTime(e.at)}</span>
      <span className="min-w-0 break-words text-sm sm:truncate">
        <span className="font-semibold">{e.actor?.displayName ?? 'System'}</span>{' '}
        <code className="rounded bg-white/5 px-1 text-xs text-pitch-400">{e.action}</code>
        {e.target && <span className="text-white/60"> {e.target}</span>}
        {e.gameCode && (
          <Link to={`/admin/games/${e.gameCode}`} className="ml-1 text-xs text-white/50 underline-offset-2 hover:underline">
            {e.gameCode}
          </Link>
        )}
      </span>
    </div>
  );
}

export function OverviewTab() {
  const q = useOverview();
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) return <p className="text-sm text-red-300">Could not load the overview. Reload to try again.</p>;
  const { counts, recent, health } = q.data;
  return (
    <>
      <AdminHeader title="Overview" description="Headline numbers, data health and the latest admin and host actions." />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Users" value={counts.users} hint={`${counts.registered} registered · ${counts.guests} guests`} />
        <StatTile label="Active lobbies" value={counts.activeLobbies} />
        <StatTile label="Auctions live" value={counts.auctionsInProgress} />
        <StatTile label="Seasons simulated" value={counts.seasonsSimulated} hint={`${counts.gamesCompleted} games completed`} />
        <StatTile label="Pool players" value={counts.activePoolPlayers} hint={`${counts.poolPlayers} in total`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardTitle>Data health</CardTitle>
          {health.length === 0 ? (
            <p className="flex items-center gap-2 rounded-xl bg-pitch-500/10 px-3 py-3 text-sm text-pitch-400">
              <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              All checks pass.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {health.map((h) => (
                <li
                  key={h.code}
                  className={cx('flex gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-inset', h.level === 'error' ? 'bg-red-500/10 text-red-200 ring-red-400/20' : 'bg-gold-400/10 text-gold ring-gold-400/20')}
                >
                  <span aria-hidden="true" className="font-bold">
                    {h.level === 'error' ? '✕' : '!'}
                  </span>
                  <span>
                    <span className="sr-only">{h.level === 'error' ? 'Error: ' : 'Warning: '}</span>
                    {h.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-white/45">
            {counts.admins} admin{counts.admins === 1 ? '' : 's'} · {counts.banned} banned
          </p>
        </Card>
        <Card className="lg:col-span-3">
          <CardTitle action={<Link to="/admin/audit" className="text-sm text-pitch-400 hover:underline">Full log</Link>}>Recent activity</CardTitle>
          {recent.length === 0 ? (
            <EmptyRow>No admin or host actions yet.</EmptyRow>
          ) : (
            <ul className="flex flex-col divide-y divide-white/5">
              {recent.map((e) => (
                <li key={e.id} className="py-2">
                  <AuditLine e={e} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
