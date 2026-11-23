import { NavLink, Outlet } from 'react-router';
import { useMe } from '../../lib/auth';
import { Card, cx, LinkButton, Skeleton } from '../../components/ui';

export const ADMIN_TABS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/pool', label: 'Pool players' },
  { to: '/admin/clubs', label: 'Clubs' },
  { to: '/admin/games', label: 'Games' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/lab', label: 'Simulation Lab' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/audit', label: 'Audit log' },
  { to: '/admin/announcements', label: 'Announcements' },
] as const;

/**
 * /admin: only admins see the panel. The server re-checks the role on every admin endpoint, so this
 * guard is for the page, not the security.
 */
export function AdminLayout() {
  const { data: me, isPending } = useMe();

  if (isPending) {
    return (
      <main className="mx-auto w-full max-w-7xl px-3 pt-6 sm:px-4">
        <Skeleton className="h-96" />
      </main>
    );
  }
  if (!me || me.role !== 'admin') {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <Card className="text-center">
          <h1 className="font-display text-3xl font-bold uppercase">Admins only</h1>
          <p className="mt-2 text-sm text-white/60">{me ? 'Your account cannot open the admin panel.' : 'Log in with an admin account to open the admin panel.'}</p>
          <div className="mt-5 flex justify-center gap-2">
            {!me && <LinkButton to="/login?next=%2Fadmin">Log in</LinkButton>}
            <LinkButton to="/" variant="secondary">
              Back home
            </LinkButton>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-3 pb-16 pt-3 sm:px-4 lg:flex-row lg:gap-6 lg:pt-6">
      <nav aria-label="Admin" className="-mx-3 shrink-0 overflow-x-auto border-b border-white/5 px-3 pb-2 sm:-mx-4 sm:px-4 lg:mx-0 lg:w-48 lg:overflow-visible lg:border-0 lg:px-0">
        <p className="mb-2 hidden text-xs font-semibold uppercase tracking-[0.25em] text-gold lg:block">Admin</p>
        <ul className="flex gap-1 lg:sticky lg:top-20 lg:flex-col">
          {ADMIN_TABS.map((t) => (
            <li key={t.to} className="shrink-0">
              <NavLink
                to={t.to}
                end={'end' in t}
                className={({ isActive }) =>
                  cx('block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition', isActive ? 'bg-pitch-500 text-ink' : 'text-white/70 hover:bg-white/10 hover:text-white')
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
