import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { LeagueTeamRow, LeagueView } from '@deadline-day/protocol';
import { get } from '../lib/api';
import { useGame } from '../hooks/useGame';
import { useMe } from '../lib/auth';
import { SeasonTeamPage } from './team/SeasonTeam';
import { Card, CardTitle, cx, LinkButton, Pill, Skeleton } from '../components/ui';
import { SeasonPitch, TeamName } from './season/parts';

/** The League Teams data; shared with the team page. Refreshes every few seconds while the auction runs. */
export function useLeague(code: string, live: boolean) {
  return useQuery({
    queryKey: ['league', code],
    queryFn: () => get<{ league: LeagueView }>(`/api/games/${code}/league`).then((r) => r.league),
    refetchInterval: live ? 5_000 : false,
    retry: false,
  });
}

const KIND_LABEL = { human: 'Auction', bot: 'Auction (bot)', ai: 'AI club' } as const;

export function LeaguePage() {
  const params = useParams();
  const { code, snapshot: snap } = useGame(params.code ?? '');
  const live = !!snap && ['auctioning', 'paused'].includes(snap.game.status);
  const q = useLeague(code, live);
  const chemOn = !!q.data?.teams.some((t) => t.chemistry !== 0);
  const back = snap?.season ? `/season/${code}` : snap?.game.status === 'auction_complete' ? `/reveal/${code}` : `/auction/${code}`;

  return (
    <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-4 sm:px-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-pitch-400">{snap?.game.name ?? code}</p>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">League Teams</h1>
          <p className="text-sm text-white/60">All 20 teams ranked by strength: the mean of attack and defense.</p>
        </div>
        <LinkButton to={back} variant="secondary" size="sm">
          {snap?.season ? 'Back to the season' : 'Back to the game'}
        </LinkButton>
      </header>

      {q.isPending ? (
        <Skeleton className="h-[32rem]" />
      ) : q.isError || !q.data ? (
        <Card>
          <p className="py-6 text-center text-white/60">The League Teams page opens when the auction starts.</p>
        </Card>
      ) : (
        <Card>
          <CardTitle action={q.data.season === null ? <Pill tone="gold">Live: auction in progress</Pill> : <Pill>Season {q.data.season}</Pill>}>Strength ranking</CardTitle>
          {q.data.season === null && <p className="-mt-1 mb-3 text-sm text-white/55">Auction teams are rated on the players they have bought so far, so their place is provisional until they have 11.</p>}
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="whitespace-nowrap text-left text-[0.7rem] uppercase tracking-wide text-white/45">
                <th className="w-8 py-1 font-medium">#</th>
                <th className="py-1 font-medium">Team</th>
                <th className="hidden w-14 py-1 text-right font-medium sm:table-cell">Att</th>
                <th className="hidden w-14 py-1 text-right font-medium sm:table-cell">Def</th>
                <th className="hidden w-16 py-1 text-right font-medium md:table-cell">Chem</th>
                <th className="w-20 py-1 text-right font-medium">Strength</th>
              </tr>
            </thead>
            <tbody>
              {q.data.teams.map((t) => (
                <LeagueRow key={t.id} team={t} code={code} chemOn={chemOn} />
              ))}
            </tbody>
          </table>
          {!chemOn && <p className="mt-3 hidden text-xs text-white/45 md:block">Chem: the chemistry bonus is switched off for this game, so it adds nothing.</p>}
        </Card>
      )}
    </main>
  );
}

function LeagueRow({ team: t, code, chemOn }: { team: LeagueTeamRow; code: string; chemOn: boolean }) {
  const empty = t.filled === 0;
  return (
    <tr className={cx('border-t border-white/5', t.kind !== 'ai' && 'bg-gold-400/[0.06]')}>
      <td className="py-2 font-display text-white/60">{t.rank}</td>
      <td className="max-w-0 py-2 pr-2">
        <Link to={`/team/${code}/${t.id}`} className="block min-w-0 hover:underline">
          <TeamName team={t} tag="wide" />
        </Link>
        <span className="mt-0.5 block truncate text-xs text-white/50">
          {KIND_LABEL[t.kind]}
          {t.managerName && ` · ${t.managerName}`} · {t.formation}
          {t.provisional && ` · ${t.filled}/11 players`}
        </span>
        <span className="block text-xs tabular-nums text-white/60 sm:hidden">
          Att {empty ? '-' : t.attack.toFixed(1)} · Def {empty ? '-' : t.defense.toFixed(1)}
        </span>
      </td>
      <td className="hidden py-2 text-right text-white/75 sm:table-cell">{empty ? '-' : t.attack.toFixed(1)}</td>
      <td className="hidden py-2 text-right text-white/75 sm:table-cell">{empty ? '-' : t.defense.toFixed(1)}</td>
      <td className="hidden py-2 text-right text-white/75 md:table-cell">{!chemOn ? '-' : t.chemistry ? `+${t.chemistry.toFixed(1)}` : '0'}</td>
      <td className="py-2 text-right font-display text-base font-bold">
        {empty ? '-' : t.strength.toFixed(1)}
        {t.provisional && !empty && <span className="block text-[0.6rem] font-normal uppercase text-gold-400">provisional</span>}
      </td>
    </tr>
  );
}

export function TeamPage() {
  const params = useParams();
  const { snapshot: snap } = useGame(params.code ?? '');
  const { data: me } = useMe();
  if (snap?.season) return <SeasonTeamPage snap={snap} me={me} teamId={params.teamId ?? ''} />;
  return <AuctionTeamPage />;
}

/** Before any season: the team as the auction has built it so far. */
function AuctionTeamPage() {
  const params = useParams();
  const { code, snapshot: snap } = useGame(params.code ?? '');
  const live = !!snap && ['auctioning', 'paused'].includes(snap.game.status);
  const q = useLeague(code, live);
  const id = params.teamId ?? '';
  const team = q.data?.teams.find((t) => t.id === id || t.participantId === id || t.clubId === id);

  return (
    <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-4 sm:px-4">
      <div className="mb-4 flex flex-wrap gap-2">
        <LinkButton to={`/league/${code}`} variant="secondary" size="sm">
          League Teams
        </LinkButton>
        {snap?.season && (
          <LinkButton to={`/season/${code}`} variant="ghost" size="sm">
            Season
          </LinkButton>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-[32rem]" />
      ) : !team ? (
        <Card>
          <p className="py-6 text-center text-white/60">That team is not in this league.</p>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <div className="flex items-center gap-3">
              <TeamName team={team} size="md" />
            </div>
            <p className="mt-1 text-sm text-white/55">
              {KIND_LABEL[team.kind]}
              {team.managerName && ` · ${team.managerName}`} · {team.formation}
            </p>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Stat label="Rank" value={`#${team.rank}`} />
              <Stat label="Attack" value={team.filled ? team.attack.toFixed(1) : '-'} />
              <Stat label="Defense" value={team.filled ? team.defense.toFixed(1) : '-'} />
            </dl>
            {team.provisional && <p className="mt-2 text-xs text-gold-400">{team.filled}/11 players so far: ratings are provisional.</p>}
            <div className="mt-4">
              <SeasonPitch formation={team.formation} players={team.players} />
            </div>
          </Card>
          <Card className="lg:col-span-3">
            <CardTitle>Starting XI</CardTitle>
            {team.players.length === 0 ? (
              <p className="py-6 text-center text-sm text-white/50">No players yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-white/5">
                {team.players.map((p) => (
                  <li key={p.slotKey} className="flex items-center gap-3 py-2">
                    <span className="w-10 shrink-0 font-display text-sm text-white/50">{p.slotKey}</span>
                    <span className="w-8 shrink-0 text-center font-display text-lg font-bold">{p.overall}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{p.reserve ? 'Academy Reserve' : p.name}</p>
                      <p className="flex flex-wrap gap-1.5 text-xs text-white/50">
                        {p.position}
                        {p.outOfPosition && <span className="text-sky-400">playing {p.slotType}{p.overall < p.baseOverall ? ` (${p.overall - p.baseOverall})` : ''}</span>}
                        {p.reserve && <Pill>Reserve</Pill>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-night-950/50 px-2 py-2 ring-1 ring-white/5">
      <dt className="text-[0.65rem] uppercase tracking-wide text-white/50">{label}</dt>
      <dd className="font-display text-lg font-semibold">{value}</dd>
    </div>
  );
}
