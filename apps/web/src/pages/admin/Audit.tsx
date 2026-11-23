import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditPage } from '@deadline-day/protocol';
import { get } from '../../lib/api';
import { Button, Card, Field, Input, Skeleton } from '../../components/ui';
import { AdminHeader, DownloadLink, EmptyRow } from './parts';
import { AuditLine } from './Overview';

interface Filters {
  actor: string;
  action: string;
  game: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { actor: '', action: '', game: '', from: '', to: '' };

/** Query string for the audit endpoints; dates are local days, inclusive. */
function toParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.actor.trim()) p.set('actor', f.actor.trim());
  if (f.action.trim()) p.set('action', f.action.trim());
  if (f.game.trim()) p.set('game', f.game.trim().toUpperCase());
  if (f.from) p.set('from', String(new Date(`${f.from}T00:00:00`).getTime()));
  if (f.to) p.set('to', String(new Date(`${f.to}T23:59:59.999`).getTime()));
  return p;
}

export function AuditTab() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  useEffect(() => {
    const id = setTimeout(() => setFilters(draft), 350);
    return () => clearTimeout(id);
  }, [draft]);
  const params = toParams(filters);
  const list = useInfiniteQuery({
    queryKey: ['admin', 'audit', params.toString()],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(params);
      if (pageParam) p.set('before', String(pageParam));
      return get<AuditPage>(`/api/admin/audit?${p}`);
    },
    getNextPageParam: (last) => last.nextBefore,
  });
  const entries = list.data?.pages.flatMap((p) => p.entries) ?? [];
  const set = (k: keyof Filters, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const any = Object.values(draft).some(Boolean);
  return (
    <>
      <AdminHeader title="Audit log" description="Every admin and host action, newest first." actions={<DownloadLink href={`/api/admin/audit/export?${params}`}>Export CSV</DownloadLink>} />
      <Card className="mb-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Actor">{(id) => <Input id={id} placeholder="name" value={draft.actor} onChange={(e) => set('actor', e.target.value)} />}</Field>
          <Field label="Action">{(id) => <Input id={id} placeholder="e.g. admin. or game.pause" value={draft.action} onChange={(e) => set('action', e.target.value)} />}</Field>
          <Field label="Game code">{(id) => <Input id={id} placeholder="ABC123" maxLength={8} value={draft.game} onChange={(e) => set('game', e.target.value)} className="uppercase" />}</Field>
          <Field label="From">{(id) => <Input id={id} type="date" value={draft.from} onChange={(e) => set('from', e.target.value)} />}</Field>
          <Field label="To">{(id) => <Input id={id} type="date" value={draft.to} onChange={(e) => set('to', e.target.value)} />}</Field>
        </div>
        {any && (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setDraft(EMPTY)}>
            Clear filters
          </Button>
        )}
      </Card>
      <Card>
        {list.isPending ? (
          <Skeleton className="h-60" />
        ) : list.isError ? (
          <p className="text-sm text-red-300">Could not load the log. Check the filters and try again.</p>
        ) : entries.length === 0 ? (
          <EmptyRow>No entries match.</EmptyRow>
        ) : (
          <ul className="flex flex-col divide-y divide-white/5">
            {entries.map((e) => (
              <li key={e.id} className="py-2">
                <details>
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <AuditLine e={e} />
                  </summary>
                  <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-night-950/60 p-2 text-xs text-white/70">{JSON.stringify({ id: e.id, actor: e.actor?.username ?? null, target: e.target, game: e.gameCode, details: e.details }, null, 2)}</pre>
                </details>
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
