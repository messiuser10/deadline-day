import { Link, useSearchParams } from 'react-router';
import type { GameSnapshot, ResultsView, SeasonTeamView, SplitView, UserView } from '@deadline-day/protocol';
import { Card, CardTitle, cx, LinkButton, Pill, Skeleton } from '../../components/ui';
import { useResults, useSeasonView } from '../../hooks/useSeasonView';
import { ordinal, type SeasonIndex } from '../../lib/season';
import { FinishedGate } from '../Results';
import { SeasonPitch, TeamName } from '../season/parts';
import { PositionChart } from './PositionChart';

const KIND_LABEL = { human: 'Auction', bot: 'Auction (bot)', ai: 'AI club' } as const;

/** Team page once a season exists: the XI as simulated, and after the final whistle the season in numbers. */
export function SeasonTeamPage({ snap, me, teamId }: { snap: GameSnapshot; me: UserView | null | undefined; teamId: string }) {
  const code = snap.game.code;
  const info = snap.season!;
  const [search] = useSearchParams();
  const latest = info.seasons.at(-1)!.number;
  const asked = Number(search.get('s'));
  const viewing = info.seasons.some((s) => s.number === asked) ? asked : latest;
  const isHost = !!me && (snap.game.hostUserId === me.id || me.role === 'admin');
  const { index, isPending } = useSeasonView(code, viewing);
  const team = index?.view.teams.find((t) => t.id === teamId || t.participantId === teamId || t.clubId === teamId);

  return (
    <main className="mx-auto w-full max-w-6xl px-3 pb-16 pt-4 sm:px-4">
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Game pages">
        <LinkButton to={`/league/${code}`} variant="secondary" size="sm">
          League Teams
        </LinkButton>
        <LinkButton to={`/season/${code}${viewing === latest ? '' : `?s=${viewing}`}`} variant="ghost" size="sm">
          Season {viewing}
        </LinkButton>
        <LinkButton to={`/results/${code}${viewing === latest ? '' : `?s=${viewing}`}`} variant="ghost" size="sm">
          Results
        </LinkButton>
        {info.seasons.length > 1 && (
          <span className="flex items-center gap-1 sm:ml-auto" role="group" aria-label="Season">
            {info.seasons.map((s) => (
              <Link
                key={s.number}
                to={`?s=${s.number}`}
                replace
                aria-current={s.number === viewing ? 'page' : undefined}
                className={cx(
                  'grid min-h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-semibold',
                  s.number === viewing ? 'bg-pitch-500 text-night-950' : 'bg-white/5 text-white/70 hover:bg-white/10',
                )}
              >
                S{s.number}
              </Link>
            ))}
          </span>
        )}
      </nav>
      {isPending || !index ? (
        <Skeleton className="h-[32rem]" />
      ) : !team ? (
        <Card>
          <p className="py-6 text-center text-white/60">That team is not in this league.</p>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <TeamName team={team} size="md" className="font-display text-2xl uppercase" />
              <p className="text-sm text-white/55">
                {KIND_LABEL[team.kind]}
                {team.managerName && ` · ${team.managerName}`} · {team.formation} · season {viewing}
              </p>
              <dl className="flex gap-2 text-center sm:ml-auto">
                <Tile label="Pre-season" value={`#${team.rank}`} />
                <Tile label="Attack" value={team.attack.toFixed(1)} />
                <Tile label="Defense" value={team.defense.toFixed(1)} />
              </dl>
            </div>
          </Card>
          <FinishedGate code={code} info={info} viewing={viewing} isHost={isHost} subject="This team's season stats">
            <TeamSeasonStats code={code} viewing={viewing} index={index} team={team} />
          </FinishedGate>
        </>
      )}
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-16 rounded-xl bg-night-950/50 px-2 py-1.5 ring-1 ring-white/5">
      <dt className="text-[0.6rem] uppercase tracking-wide text-white/50">{label}</dt>
      <dd className="font-display text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function TeamSeasonStats({ code, viewing, index, team }: { code: string; viewing: number; index: SeasonIndex; team: SeasonTeamView }) {
  const q = useResults(code, viewing);
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) return <p className="text-center text-sm text-red-300">Could not load the season stats.</p>;
  const results: ResultsView = q.data;
  const report = results.reports.find((r) => r.teamId === team.id);
  const row = index.view.standings.at(-1)?.find((r) => r.teamId === team.id);
  const players = results.players.filter((p) => p.teamId === team.id);
  const statOf = new Map(players.map((p) => [p.ref, p]));
  const grade = results.grades.find((g) => g.teamId === team.id);
  if (!report || !row) return null;

  const note = (ref: string, slotType: string) => {
    const s = statOf.get(ref);
    if (!s) return null;
    const extra = slotType === 'GK' ? `${s.cleanSheets}CS` : s.goals || s.assists ? `${s.goals}G ${s.assists}A` : '';
    return `${s.avgRating.toFixed(1)}${extra ? ` · ${extra}` : ''}`;
  };
  const opp = (id: string) => index.teams.get(id)?.name ?? '?';

  return (
    <div className="grid items-start gap-4 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
        <Card>
          <CardTitle action={grade && <Pill tone="gold">Auction grade {grade.grade}</Pill>}>Season {viewing}</CardTitle>
          <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Tile label="Finished" value={ordinal(row.position)} />
            <Tile label="Points" value={String(row.points)} />
            <Tile label="W-D-L" value={`${row.won}-${row.drawn}-${row.lost}`} />
            <Tile label="Goals" value={`${row.goalsFor}-${row.goalsAgainst}`} />
          </dl>
        </Card>
        <Card>
          <CardTitle>Form timeline</CardTitle>
          <PositionChart index={index} report={report} teamId={team.id} />
        </Card>
        <Card>
          <CardTitle>Home and away</CardTitle>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[0.7rem] uppercase tracking-wide text-white/45">
                <th className="py-1 font-medium" />
                <th className="w-8 py-1 text-right font-medium">P</th>
                <th className="w-8 py-1 text-right font-medium">W</th>
                <th className="w-8 py-1 text-right font-medium">D</th>
                <th className="w-8 py-1 text-right font-medium">L</th>
                <th className="w-14 py-1 text-right font-medium">Goals</th>
                <th className="w-10 py-1 text-right font-medium">Pts</th>
              </tr>
            </thead>
            <tbody>
              <SplitRow label="Home" s={report.home} />
              <SplitRow label="Away" s={report.away} />
            </tbody>
          </table>
          <dl className="mt-4 grid gap-2 sm:grid-cols-3">
            <Highlight
              label="Biggest win"
              value={report.biggestWin ? `${report.biggestWin.goalsFor}-${report.biggestWin.goalsAgainst} ${report.biggestWin.home ? 'v' : 'at'} ${opp(report.biggestWin.opponentId)}` : 'No wins'}
              sub={report.biggestWin ? `Matchday ${report.biggestWin.matchday}` : undefined}
            />
            <Highlight
              label="Longest unbeaten run"
              value={report.longestUnbeaten ? `${report.longestUnbeaten.length} ${report.longestUnbeaten.length === 1 ? 'match' : 'matches'}` : 'None'}
              sub={report.longestUnbeaten ? `Matchdays ${report.longestUnbeaten.from} to ${report.longestUnbeaten.to}` : undefined}
            />
            <Highlight label="Top scorer" value={report.topScorer ? report.topScorer.name : 'Nobody scored'} sub={report.topScorer ? `${report.topScorer.goals} goals` : undefined} />
          </dl>
        </Card>
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
        <Card>
          <CardTitle action={<span className="text-xs text-white/50">{team.formation}</span>}>The XI</CardTitle>
          <SeasonPitch formation={team.formation} players={team.players} note={(p) => note(p.ref, p.slotType)} />
          <p className="mt-2 text-xs text-white/45">Under each name: average rating, then goals and assists (clean sheets for the keeper).</p>
        </Card>
        <Card>
          <CardTitle>Player stats</CardTitle>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[0.7rem] uppercase tracking-wide text-white/45">
                <th className="py-1 font-medium">Player</th>
                <th className="w-9 py-1 text-right font-medium" title="Appearances">Apps</th>
                <th className="w-7 py-1 text-right font-medium" title="Goals">G</th>
                <th className="w-7 py-1 text-right font-medium" title="Assists">A</th>
                <th className="hidden w-8 py-1 text-right font-medium sm:table-cell" title="Clean sheets">CS</th>
                <th className="w-11 py-1 text-right font-medium" title="Average rating">Avg</th>
              </tr>
            </thead>
            <tbody>
              {[...players]
                .sort((a, b) => b.avgRating - a.avgRating)
                .map((p) => (
                  <tr key={p.ref} className="border-t border-white/5">
                    <td className="max-w-0 truncate py-1.5 pr-2">
                      {p.name}
                      <span className="ml-1 text-xs text-white/40">{p.slotKey ?? 'cover'}</span>
                    </td>
                    <td className="py-1.5 text-right text-white/70">{p.appearances}</td>
                    <td className="py-1.5 text-right">{p.goals}</td>
                    <td className="py-1.5 text-right">{p.assists}</td>
                    <td className="hidden py-1.5 text-right text-white/70 sm:table-cell">{p.cleanSheets}</td>
                    <td className="py-1.5 text-right font-semibold">{p.avgRating.toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function SplitRow({ label, s }: { label: string; s: SplitView }) {
  return (
    <tr className="border-t border-white/5">
      <th scope="row" className="py-1.5 text-left font-medium">
        {label}
      </th>
      <td className="py-1.5 text-right text-white/70">{s.played}</td>
      <td className="py-1.5 text-right">{s.won}</td>
      <td className="py-1.5 text-right">{s.drawn}</td>
      <td className="py-1.5 text-right">{s.lost}</td>
      <td className="py-1.5 text-right text-white/70">
        {s.goalsFor}-{s.goalsAgainst}
      </td>
      <td className="py-1.5 text-right font-display font-bold">{s.points}</td>
    </tr>
  );
}

function Highlight({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-night-950/50 px-3 py-2 ring-1 ring-white/5">
      <dt className="text-[0.65rem] uppercase tracking-wide text-white/50">{label}</dt>
      <dd className="font-semibold leading-snug">{value}</dd>
      {sub && <dd className="text-xs text-white/50">{sub}</dd>}
    </div>
  );
}
