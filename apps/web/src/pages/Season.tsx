import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { GameSnapshot, SeasonInfo, SeasonView, UserView } from '@deadline-day/protocol';
import { useMe } from '../lib/auth';
import { get } from '../lib/api';
import { indexSeason, ordinal } from '../lib/season';
import { useGame } from '../hooks/useGame';
import { usePlayback } from '../hooks/usePlayback';
import { useMediaQuery } from '../hooks/useClock';
import { LinkButton, Pill, Skeleton } from '../components/ui';
import { SwipeTabs } from '../components/SwipeTabs';
import { ExpectedStrength, MultiSeason, SeasonsHistory } from './season/Analysis';
import { MomentsFeed, visibleMoments } from './season/Moments';
import { PlaybackBar, PlaybackCard } from './season/Playback';
import { MatchdayResults, TickerModal } from './season/Results';
import { LeagueTable } from './season/Table';
import { TeamName, Trophy } from './season/parts';

export function SeasonPage() {
  const params = useParams();
  const { code, snapshot: snap, error } = useGame(params.code ?? '');
  const { data: me } = useMe();
  const navigate = useNavigate();
  const status = snap?.game.status;

  useEffect(() => {
    if (!snap || snap.season) return;
    if (status === 'lobby') void navigate(`/lobby/${code}`, { replace: true });
    else if (status === 'auctioning' || status === 'paused') void navigate(`/auction/${code}`, { replace: true });
    else if (status === 'auction_complete') void navigate(`/reveal/${code}`, { replace: true });
  }, [snap, status, code, navigate]);

  if (error) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-4xl font-bold uppercase">Game not found</h1>
        <LinkButton to="/" className="mt-6">
          Back home
        </LinkButton>
      </main>
    );
  }
  if (!snap?.season) {
    return (
      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </main>
    );
  }
  return <SeasonRoom snap={snap} info={snap.season} me={me} />;
}

function SeasonRoom({ snap, info, me }: { snap: GameSnapshot; info: SeasonInfo; me: UserView | null | undefined }) {
  const code = snap.game.code;
  const [search, setSearch] = useSearchParams();
  const latest = info.seasons.at(-1)!.number;
  const asked = Number(search.get('s'));
  const viewing = info.seasons.some((s) => s.number === asked) ? asked : latest;
  const isHost = !!me && (snap.game.hostUserId === me.id || me.role === 'admin');
  const wide = useMediaQuery('(min-width: 1024px)');
  const [fixtureId, setFixtureId] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['season', code, viewing],
    queryFn: () => get<{ season: SeasonView }>(`/api/games/${code}/season?number=${viewing}`).then((r) => r.season),
    staleTime: Infinity,
  });
  const index = useMemo(() => (q.data ? indexSeason(q.data) : null), [q.data]);
  const p = usePlayback({ code, shared: info.playback, viewing, isHost });

  const onView = (n: number | null) => {
    const next = new URLSearchParams(search);
    if (n === null) next.delete('s');
    else next.set('s', String(n));
    setSearch(next, { replace: true });
  };

  if (!index) {
    return (
      <main className="mx-auto grid w-full max-w-6xl gap-4 px-3 py-6 sm:px-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[28rem]" />
        {q.isError && <p className="text-center text-sm text-red-300">Could not load the season. Reload the page to try again.</p>}
      </main>
    );
  }

  const clock = p.clock;
  const champion = clock.finished ? index.teams.get(index.view.championId) : undefined;
  const hideLatest = snap.game.status === 'simulating' || (viewing === latest && !clock.finished);
  const mine = snap.participants.find((x) => x.userId === me?.id);
  const myTeam = mine ? index.view.teams.find((t) => t.participantId === mine.id) : undefined;
  const myRow = myTeam && clock.completed > 0 ? index.view.standings[clock.completed - 1]?.find((r) => r.teamId === myTeam.id) : undefined;

  const results = <MatchdayResults index={index} clock={clock} matchday={clock.matchday} onOpen={setFixtureId} />;
  const table = <LeagueTable index={index} completed={clock.completed} code={code} finished={clock.finished} />;
  const analysis = (
    <>
      <SeasonsHistory code={code} info={info} viewing={viewing} isHost={isHost} hideLatest={hideLatest} onView={onView} />
      <ExpectedStrength code={code} index={index} />
      <MultiSeason code={code} index={index} />
    </>
  );

  return (
    <main className={`mx-auto w-full max-w-6xl px-3 pt-4 sm:px-4 ${wide ? 'pb-16' : 'pb-40'}`}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-pitch-400">
            {viewing === latest ? 'Season' : 'Earlier season'} {viewing}
          </p>
          <h1 className="truncate font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{snap.game.name}</h1>
          <p className="text-sm text-white/60">
            {index.view.goalsPerMatch.toFixed(2)} goals per match · seed {index.view.seed}
          </p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Game pages">
          <LinkButton to={`/reveal/${code}`} variant="secondary" size="sm">
            Team Reveal
          </LinkButton>
          <LinkButton to={`/league/${code}`} variant="secondary" size="sm">
            League Teams
          </LinkButton>
        </nav>
      </header>

      {champion && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-gold-400 px-4 py-3 text-night-950 shadow-lg shadow-gold-400/20 motion-safe:animate-[rise_0.4s_ease-out]" role="status">
          <Trophy className="size-8" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest">Champions</p>
            <p className="truncate font-display text-2xl font-bold uppercase">{champion.name}</p>
          </div>
          {myRow && myTeam && myTeam.id !== champion.id && (
            <p className="ml-auto text-sm font-medium">
              {myTeam.name} finished {ordinal(myRow.position)} with {myRow.points} points
            </p>
          )}
        </div>
      )}

      {myTeam && !champion && myRow && (
        <p className="mb-3 flex items-center gap-2 text-sm text-white/70">
          <TeamName team={myTeam} tag={false} /> <Pill tone="gold">{ordinal(myRow.position)}</Pill> <span>{myRow.points} pts</span>
        </p>
      )}

      {wide ? (
        <>
          <div className="mb-4">
            <PlaybackCard p={p} />
          </div>
          <div className="grid grid-cols-12 items-start gap-4">
            <div className="col-span-7 flex min-w-0 flex-col gap-4">
              {results}
              <MomentsFeed index={index} clock={clock} onOpen={setFixtureId} limit={12} />
            </div>
            <div className="col-span-5 min-w-0 lg:sticky lg:top-[4.25rem]">
              <LeagueTable index={index} completed={clock.completed} code={code} finished={clock.finished} compact />
            </div>
          </div>
          <section className="mt-6 grid grid-cols-2 items-start gap-4" aria-label="Seasons and analysis">
            <SeasonsHistory code={code} info={info} viewing={viewing} isHost={isHost} hideLatest={hideLatest} onView={onView} />
            <MultiSeason code={code} index={index} />
            <div className="col-span-2">
              <ExpectedStrength code={code} index={index} />
            </div>
          </section>
        </>
      ) : (
        <>
          <SwipeTabs
            label="Season panels"
            tabs={[
              { id: 'results', label: 'Results', content: results },
              { id: 'table', label: 'Table', content: table },
              {
                id: 'moments',
                label: 'Moments',
                badge: <span className="rounded-full bg-night-950/40 px-1.5 text-xs">{visibleMoments(index, clock).length}</span>,
                content: <MomentsFeed index={index} clock={clock} onOpen={setFixtureId} />,
              },
              { id: 'more', label: 'Seasons', content: analysis },
            ]}
          />
          <PlaybackBar p={p} />
        </>
      )}

      <TickerModal index={index} fixtureId={fixtureId} clock={clock} onClose={() => setFixtureId(null)} />
    </main>
  );
}
