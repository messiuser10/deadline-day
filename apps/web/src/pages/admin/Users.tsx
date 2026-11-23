import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AdminUserDetail, AdminUserRow } from '@deadline-day/protocol';
import { get, patch, post } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { Button, Card, cx, Field, Input, Modal, Pill, Skeleton } from '../../components/ui';
import { AdminHeader, dateTime, EmptyRow, Select, useAdminMutation } from './parts';
import { StatusPill } from './Games';

type Filter = 'all' | 'registered' | 'guests' | 'admins' | 'banned';
const USERS_KEY = ['admin', 'users'];

function UserModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: me } = useMe();
  const key = ['admin', 'user', id];
  const q = useQuery({ queryKey: key, queryFn: async () => (await get<{ detail: AdminUserDetail }>(`/api/admin/users/${id}`)).detail });
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const change = useAdminMutation((body: { role?: 'admin' | 'user'; banned?: boolean }) => patch(`/api/admin/users/${id}`, body), { invalidate: [key, USERS_KEY, ['admin', 'overview']], success: 'User updated' });
  const remove = useAdminMutation(() => post(`/api/admin/users/${id}/delete`, { confirm }), { invalidate: [USERS_KEY, ['admin', 'overview']], success: 'User deleted', onSuccess: onClose });
  const u = q.data?.user;
  const self = u?.id === me?.id;
  return (
    <Modal open onClose={onClose} title={u ? u.displayName : 'User'}>
      {!q.data || !u ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
            <span className="font-mono">@{u.username}</span>
            {u.role === 'admin' && <Pill tone="gold">Admin</Pill>}
            {u.isGuest && <Pill>Guest</Pill>}
            {u.banned && <Pill tone="red">Banned</Pill>}
            <span className="text-xs text-white/45">joined {dateTime(u.createdAt)}</span>
            {!u.isGuest && (
              <Link to={`/profile/${encodeURIComponent(u.username)}`} className="text-xs text-pitch-400 hover:underline">
                Profile
              </Link>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {u.role === 'admin' ? (
              <Button size="sm" variant="secondary" disabled={self} onClick={() => change.mutate({ role: 'user' })} loading={change.isPending}>
                Demote to user
              </Button>
            ) : (
              <Button size="sm" variant="secondary" disabled={u.isGuest} onClick={() => change.mutate({ role: 'admin' })} loading={change.isPending}>
                Promote to admin
              </Button>
            )}
            {u.banned ? (
              <Button size="sm" variant="secondary" onClick={() => change.mutate({ banned: false })}>
                Unban
              </Button>
            ) : (
              <Button size="sm" variant="danger" disabled={self} onClick={() => change.mutate({ banned: true })}>
                Ban
              </Button>
            )}
          </div>
          {self && <p className="text-xs text-white/45">You cannot demote, ban or delete yourself.</p>}
          {u.isGuest && u.role !== 'admin' && <p className="text-xs text-white/45">Guests cannot be admins.</p>}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-white/80">Games ({q.data.games.length})</h3>
            {q.data.games.length === 0 ? (
              <EmptyRow>No games yet.</EmptyRow>
            ) : (
              <ul className="flex max-h-64 flex-col divide-y divide-white/5 overflow-y-auto rounded-xl bg-night-950/40 ring-1 ring-white/5">
                {q.data.games.map((g) => (
                  <li key={g.code}>
                    <Link to={`/admin/games/${g.code}`} onClick={onClose} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{g.name}</span>
                        <span className="block truncate text-xs text-white/45">
                          {g.code} · {g.teamName ?? 'no team'}
                          {g.isHost && ' · host'} · {dateTime(g.createdAt)}
                        </span>
                      </span>
                      <StatusPill status={g.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!self && (
            <section className="rounded-2xl bg-red-500/5 p-3 ring-1 ring-inset ring-red-400/20">
              {!deleting ? (
                <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
                  Delete this user's data
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-white/80">Deletes the account, sessions and chat messages. Finished games keep their teams, unlinked; games they host pass to you. Refused while they are in an unfinished game.</p>
                  <Field label={`Type ${u.username} to confirm`}>{(fid) => <Input id={fid} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />}</Field>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => (setDeleting(false), setConfirm(''))}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="danger" disabled={confirm !== u.username} loading={remove.isPending} onClick={() => remove.mutate(undefined)}>
                      Delete for good
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

export function UsersTab() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const list = useQuery({
    queryKey: [...USERS_KEY, q, filter],
    queryFn: async () => (await get<{ users: AdminUserRow[] }>(`/api/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), filter })}`)).users,
  });
  return (
    <>
      <AdminHeader title="Users" description="Search, promote or demote, ban or unban, see a user's games or delete their data. Shows the newest 200 matches." />
      <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
        <Input aria-label="Search users" placeholder="Search username or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-36">
          <option value="all">Everyone</option>
          <option value="registered">Registered</option>
          <option value="guests">Guests</option>
          <option value="admins">Admins</option>
          <option value="banned">Banned</option>
        </Select>
      </div>
      <Card className="!p-0 sm:!p-0">
        {list.isPending ? (
          <Skeleton className="m-4 h-60" />
        ) : !list.data?.length ? (
          <div className="p-4">
            <EmptyRow>No users match.</EmptyRow>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.data.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => setOpen(u.id)} className={cx('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5 sm:px-4', u.banned && 'opacity-60')}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold uppercase">{u.displayName.slice(0, 1)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{u.displayName}</span>
                      {u.role === 'admin' && <Pill tone="gold">Admin</Pill>}
                      {u.isGuest && <Pill>Guest</Pill>}
                      {u.banned && <Pill tone="red">Banned</Pill>}
                    </span>
                    <span className="block truncate text-xs text-white/45">
                      @{u.username} · {u.games} game{u.games === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-xs tabular-nums text-white/45 sm:block">{dateTime(u.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <UserModal key={open} id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
