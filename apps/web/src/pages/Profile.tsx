import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ProfileView, TrophyKind } from '@deadline-day/protocol';
import { ApiError, get } from '../lib/api';
import { useMe } from '../lib/auth';
import { plural } from '../lib/format';
import { ordinal } from '../lib/season';
import { Card, CardTitle, LinkButton, Pill, Skeleton } from '../components/ui';
import { SignInGate } from '../components/SignInGate';
import { TeamBadge } from '../components/team';
import { Trophy } from './season/parts';
import { dateOf, GameLink, GradeChip, TROPHY_LABEL, TrophyIcon } from './history/parts';

/** /profile: the signed-in player's own profile. */
export function MyProfilePage() {
  const { data: me, isPending } = useMe();
  if (isPending) return <Shell><Skeleton className="h-96" /></Shell>;
  if (!me)
    return (
      <Shell>
        <Card className="mx-auto max-w-md">
          <CardTitle>Your profile</CardTitle>
          <SignInGate why="Sign in or pick a guest name to see your games, titles and trophies." />
        </Card>
      </Shell>
    );
  return <ProfileScreen path="/api/profile" own />;
}

/** /profile/:username: anyone's public profile. */
export function UserProfilePage() {
  const { username = '' } = useParams();
  const { data: me } = useMe();
  return <ProfileScreen path={`/api/profiles/${encodeURIComponent(username)}`} own={me?.username === username} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-6xl px-3 pb-16 pt-4 sm:px-4">{children}</main>;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-night-800/70 px-3 py-3 text-center ring-1 ring-white/5">
      <dt className="text-[0.65rem] uppercase tracking-wide text-white/50">{label}</dt>
      <dd className="mt-0.5 font-display text-3xl font-bold tabular-nums leading-none">{value}</dd>
    </div>
  );
}

function ProfileScreen({ path, own = false }: { path: string; own?: boolean }) {
  const q = useQuery({
    queryKey: ['profile', path],
    queryFn: async () => (await get<{ profile: ProfileView }>(path)).profile,
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
  });

  if (q.isPending) return <Shell><Skeleton className="h-96" /></Shell>;
  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Shell>
        <Card className="mx-auto max-w-md text-center">
          <p className="py-6 text-white/60">{missing ? 'There is no player with that username.' : 'Could not load this profile. Reload to try again.'}</p>
          <LinkButton to="/leaderboard" variant="secondary">See the leaderboard</LinkButton>
        </Card>
      </Shell>
    );
  }

  const p = q.data;
  const s = p.stats;
  return (
    <Shell>
      <header className="mb-4 flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-pitch-500/20 font-display text-2xl font-bold uppercase text-pitch-400 ring-1 ring-pitch-500/40 sm:size-16">
          {p.displayName.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <h1 className="flex min-w-0 items-center gap-2 font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">
            <span className="truncate">{p.displayName}</span>
            {p.isGuest && <Pill>Guest</Pill>}
          </h1>
          <p className="truncate text-sm text-white/55">
            @{p.username} · joined {dateOf(p.joinedAt)}
          </p>
        </div>
      </header>

      {own && p.isGuest && (
        <p className="mb-4 rounded-2xl bg-gold-400/10 px-4 py-3 text-sm ring-1 ring-gold-400/25">
          You are playing as a guest, so you are not on the leaderboard.{' '}
          <Link to="/login?tab=register&next=/profile" className="font-semibold text-gold-400 underline-offset-2 hover:underline">
            Create an account
          </Link>{' '}
          to keep this history.
        </p>
      )}

      <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Games" value={s.games} />
        <Stat label="Titles" value={s.titles} />
        <Stat label="Top four" value={s.topFour} />
        <Stat label="Avg finish" value={s.avgFinish === null ? '-' : s.avgFinish.toFixed(1)} />
        <div className="col-span-2 sm:col-span-1">
          <Stat label="Best grade" value={s.bestGrade ?? '-'} />
        </div>
      </dl>

      <div className="grid items-start gap-4 lg:grid-cols-12">
        <TrophyCabinet profile={p} own={own} />
        <Card className="min-w-0 lg:col-span-7">
          <CardTitle action={<span className="text-xs text-white/50">{plural(p.games.length, 'game')}</span>}>Games</CardTitle>
          {p.games.length === 0 ? (
            <p className="rounded-xl bg-night-950/40 px-4 py-6 text-center text-sm text-white/50">
              {own ? 'No finished games yet. Play one through to the final whistle and it shows up here.' : 'No finished games yet.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {p.games.map((g, i) => (
                <li key={`${g.gameCode ?? 'private'}-${i}`}>
                  <GameLink code={g.gameCode} className="flex min-h-14 items-center gap-3 rounded-xl bg-night-950/50 px-3 py-2 ring-1 ring-white/5">
                    <TeamBadge color={g.color} monogram={g.monogram} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5 font-semibold">
                        <span className="truncate">{g.teamName}</span>
                        {g.champion && <Trophy className="size-4 shrink-0 text-gold-400" />}
                      </span>
                      <span className="block truncate text-xs text-white/50">
                        {g.gameCode ? g.gameName : 'Private game'} · {dateOf(g.playedAt)} · {plural(g.auctionTeams, 'auction team')}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-display text-xl font-bold leading-none">{ordinal(g.position)}</span>
                      <span className="block text-xs tabular-nums text-white/50">{g.points} pts</span>
                    </span>
                    <GradeChip grade={g.grade} className="shrink-0" />
                  </GameLink>
                </li>
              ))}
            </ul>
          )}
          {p.games.length > 0 && <p className="mt-3 text-xs text-white/45">Each game counts its first season, the official result. Run It Back seasons are for fun.</p>}
        </Card>
      </div>
    </Shell>
  );
}

function TrophyCabinet({ profile, own }: { profile: ProfileView; own: boolean }) {
  const counts = new Map<TrophyKind, number>();
  for (const t of profile.trophies) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
  return (
    <Card className="min-w-0 lg:col-span-5">
      <CardTitle>Trophy cabinet</CardTitle>
      {profile.trophies.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-night-950/40 px-4 py-8 text-center">
          <Trophy className="size-10 text-white/15" />
          <p className="text-sm text-white/50">
            {own ? 'Empty for now. Win the league, or sign the Golden Boot winner, to put something here.' : 'No trophies yet.'}
          </p>
        </div>
      ) : (
        <>
          <p className="-mt-1 mb-3 flex flex-wrap gap-1.5">
            {[...counts].map(([kind, n]) => (
              <Pill key={kind} tone={kind === 'title' ? 'gold' : 'neutral'}>
                {n} × {TROPHY_LABEL[kind]}
              </Pill>
            ))}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {profile.trophies.map((t, i) => (
              <li key={`${t.kind}-${t.at}-${i}`}>
                <GameLink
                  code={t.gameCode}
                  className={`flex h-full gap-3 rounded-xl px-3 py-2.5 ring-1 ${t.kind === 'title' ? 'bg-gold-400/10 ring-gold-400/30' : 'bg-night-950/50 ring-white/5'}`}
                >
                  <TrophyIcon kind={t.kind} className="mt-0.5 size-6 shrink-0 text-gold-400" />
                  <span className="min-w-0">
                    <span className="block text-[0.7rem] font-semibold uppercase tracking-wide text-gold-400">{TROPHY_LABEL[t.kind]}</span>
                    <span className="block text-sm font-semibold leading-snug">{t.kind === 'title' ? t.teamName : t.detail.replace(/^[^:]+:\s*/, '')}</span>
                    <span className="block truncate text-xs text-white/60">{t.kind === 'title' ? t.detail : t.teamName}</span>
                    <span className="block truncate text-xs text-white/45">
                      {t.gameCode ? t.gameName : 'Private game'} · {dateOf(t.at)}
                    </span>
                  </span>
                </GameLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
