import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useLogout, useMe, usePublicSettings } from '../lib/auth';
import { useConnection } from '../lib/socket';
import { setPref, usePrefs } from '../lib/prefs';
import { playGavel, unlockAudio } from '../lib/sound';
import { cx, LinkButton, Pill } from './ui';

export function Header() {
  const { data: me } = useMe();
  const { data: settings } = usePublicSettings();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const loginHref = `/login?next=${encodeURIComponent(location.pathname)}`;

  // Close the account menu on a tap or click outside it, or on Escape (phones have no mouse-leave).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      {settings?.maintenanceBanner && (
        <div className="bg-gold-400 px-4 py-2 text-center text-sm font-semibold text-ink">{settings.maintenanceBanner}</div>
      )}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-night-900/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold uppercase tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-pitch-500 text-sm text-ink">DD</span>
            <span className="hidden min-[360px]:inline">Deadline Day</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link to="/hall-of-fame" className="hidden rounded-lg px-3 py-2 text-sm text-white/70 hover:text-white md:block">
              Hall of Fame
            </Link>
            <Link to="/leaderboard" className="hidden rounded-lg px-3 py-2 text-sm text-white/70 hover:text-white md:block">
              Leaderboard
            </Link>
            <Link to="/how-to-play" className="hidden rounded-lg px-3 py-2 text-sm text-white/70 hover:text-white sm:block">
              How to play
            </Link>
            {me?.role === 'admin' && (
              <Link to="/admin" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-gold hover:text-white lg:block">
                Admin
              </Link>
            )}
            <PrefButtons />
            {me ? (
              <div className="relative" ref={menu}>
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}
                  className="flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm hover:bg-white/10"
                >
                  <span className="grid size-7 place-items-center rounded-full bg-white/10 text-xs font-bold uppercase">{me.displayName.slice(0, 1)}</span>
                  <span className="hidden max-w-28 truncate sm:inline">{me.displayName}</span>
                  <span className="sr-only sm:hidden">{me.displayName}, account menu</span>
                  {me.isGuest && <Pill>Guest</Pill>}
                  {me.role === 'admin' && <span className="hidden sm:inline-flex"><Pill tone="gold">Admin</Pill></span>}
                </button>
                {open && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl bg-night-800 p-2 shadow-2xl ring-1 ring-white/10" onMouseLeave={() => setOpen(false)}>
                    <p className="truncate px-3 pb-2 pt-1 text-xs text-white/50 sm:hidden">Signed in as {me.displayName}</p>
                    <MenuLink to="/profile" onClick={() => setOpen(false)}>
                      My profile
                    </MenuLink>
                    {me.role === 'admin' && (
                      <MenuLink to="/admin" onClick={() => setOpen(false)} className="text-gold">
                        Admin panel
                      </MenuLink>
                    )}
                    <MenuLink to="/hall-of-fame" onClick={() => setOpen(false)} className="md:hidden">
                      Hall of Fame
                    </MenuLink>
                    <MenuLink to="/leaderboard" onClick={() => setOpen(false)} className="md:hidden">
                      Leaderboard
                    </MenuLink>
                    <MenuLink to="/how-to-play" onClick={() => setOpen(false)} className="sm:hidden">
                      How to play
                    </MenuLink>
                    <div className="my-1 h-px bg-white/10" />
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
      <ConnectionBanner />
    </>
  );
}

/** A dropped live connection (after a short grace period, so quick reconnects do not flash it). */
function ConnectionBanner() {
  const state = useConnection((s) => s.state);
  const everOnline = useConnection((s) => s.everOnline);
  const [show, setShow] = useState(false);
  const down = everOnline && state !== 'online';
  useEffect(() => {
    if (!down) {
      setShow(false);
      return;
    }
    const id = setTimeout(() => setShow(true), 2000);
    return () => clearTimeout(id);
  }, [down]);
  if (!show) return null;
  return (
    <div className="sticky top-14 z-20 flex items-center justify-center gap-2 bg-red-500/15 px-4 py-2 text-center text-sm text-red-200 backdrop-blur" role="status">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-400" aria-hidden="true" />
      Connection lost. Reconnecting… Your game carries on on the server.
    </div>
  );
}

const iconButton =
  'grid size-10 shrink-0 place-items-center rounded-xl text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-pitch-400';

/** Theme (dark by default) and sound (off by default) switches, stored on this device. */
function PrefButtons() {
  const theme = usePrefs((p) => p.theme);
  const sound = usePrefs((p) => p.sound);
  const light = theme === 'light';
  return (
    <>
      <button
        type="button"
        className={iconButton}
        onClick={() => setPref('theme', light ? 'dark' : 'light')}
        aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
        title={light ? 'Dark theme' : 'Light theme'}
      >
        {light ? (
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={iconButton}
        onClick={() => {
          setPref('sound', !sound);
          if (!sound) {
            unlockAudio();
            playGavel();
          }
        }}
        aria-pressed={sound}
        aria-label="Sound effects"
        title={sound ? 'Sound on' : 'Sound off'}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" strokeLinejoin="round" />
          {sound ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" strokeLinecap="round" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" strokeLinecap="round" />}
        </svg>
      </button>
    </>
  );
}

function MenuLink({ to, onClick, className, children }: { to: string; onClick: () => void; className?: string; children: string }) {
  return (
    <Link to={to} onClick={onClick} className={cx('block rounded-lg px-3 py-2 text-sm hover:bg-white/10', className)}>
      {children}
    </Link>
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
