import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useLogout, useMe, usePublicSettings } from '../lib/auth';
import { useConnection } from '../lib/socket';
import { cx, LinkButton, Pill } from './ui';

export function Header() {
  const { data: me } = useMe();
  const { data: settings } = usePublicSettings();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const loginHref = `/login?next=${encodeURIComponent(location.pathname)}`;

  return (
    <>
      {settings?.maintenanceBanner && (
        <div className="bg-gold-400 px-4 py-2 text-center text-sm font-semibold text-night-950">{settings.maintenanceBanner}</div>
      )}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-night-900/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold uppercase tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-pitch-500 text-sm text-night-950">DD</span>
            <span className="hidden min-[360px]:inline">Deadline Day</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link to="/how-to-play" className="hidden rounded-lg px-3 py-2 text-sm text-white/70 hover:text-white sm:block">
              How to play
            </Link>
            {me ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}
                  className="flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm hover:bg-white/10"
                >
                  <span className="grid size-7 place-items-center rounded-full bg-white/10 text-xs font-bold uppercase">{me.displayName.slice(0, 1)}</span>
                  <span className="max-w-28 truncate">{me.displayName}</span>
                  {me.isGuest && <Pill>Guest</Pill>}
                  {me.role === 'admin' && <Pill tone="gold">Admin</Pill>}
                </button>
                {open && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl bg-night-800 p-2 shadow-2xl ring-1 ring-white/10" onMouseLeave={() => setOpen(false)}>
                    {me.isGuest && (
                      <Link to={`${loginHref}&tab=register`} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-white/10">
                        Save progress: create an account
                      </Link>
                    )}
                    <button
                      type="button"
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10"
                      onClick={() => {
                        setOpen(false);
                        logout.mutate({}, { onSuccess: () => void navigate('/') });
                      }}
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <LinkButton to={loginHref} size="sm" variant="secondary">Log in</LinkButton>
            )}
          </nav>
        </div>
      </header>
    </>
  );
}

export function ConnectionDot() {
  const state = useConnection((s) => s.state);
  const label = state === 'online' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-white/60" role="status">
      <span
        className={cx(
          'size-2 rounded-full',
          state === 'online' && 'bg-pitch-400',
          state === 'connecting' && 'animate-pulse bg-gold-400',
          state === 'offline' && 'bg-red-400',
        )}
      />
      {label}
    </span>
  );
}
