import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { GameSnapshot, ResultsView, SeasonInfo, UserView } from '@deadline-day/protocol';
import { useMe } from '../lib/auth';
import { post } from '../lib/api';
import { money } from '../lib/format';
import { GRADE_TEXT, copyText, gradeTone, summaryText } from '../lib/results';
import { ordinal, teamKey, type SeasonIndex } from '../lib/season';
import { downloadBlob, seasonCardBlob } from '../lib/shareImage';
import { toast } from '../stores/toast';
import { useGame } from '../hooks/useGame';
import { useAction } from '../hooks/useAction';
import { useMediaQuery } from '../hooks/useClock';
import { usePlayback } from '../hooks/usePlayback';
import { useResults, useSeasonView } from '../hooks/useSeasonView';
import { Button, Card, CardTitle, cx, LinkButton, Skeleton } from '../components/ui';
import { Confetti } from '../components/Confetti';
import { SwipeTabs } from '../components/SwipeTabs';
import { SeasonsHistory } from './season/Analysis';
import { LeagueTable } from './season/Table';
import { TeamName, Trophy } from './season/parts';
import { AwardsGrid, TeamOfTheSeason } from './results/Awards';
import { AuctionGrades, HeadToHead } from './results/Grades';

export function ResultsPage() {
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
  return <ResultsRoom snap={snap} info={snap.season} me={me} />;
}

function ResultsRoom({ snap, info, me }: { snap: GameSnapshot; info: SeasonInfo; me: UserView | null | undefined }) {
  const code = snap.game.code;
  const [search, setSearch] = useSearchParams();
  const latest = info.seasons.at(-1)!.number;
  const asked = Number(search.get('s'));
  const viewing = info.seasons.some((s) => s.number === asked) ? asked : latest;
  const isHost = !!me && (snap.game.hostUserId === me.id || me.role === 'admin');
  const { index, isError } = useSeasonView(code, viewing);

  const onView = (n: number | null) => {
    const next = new URLSearchParams(search);
    if (n === null) next.delete('s');
    else next.set('s', String(n));
    setSearch(next, { replace: true });
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-3 pb-16 pt-4 sm:px-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-pitch-400">Season {viewing} results</p>
          <h1 className="truncate font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{snap.game.name}</h1>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Game pages">
          <LinkButton to={`/season/${code}${viewing === latest ? '' : `?s=${viewing}`}`} variant="secondary" size="sm">
            Season
          </LinkButton>
          <LinkButton to={`/league/${code}`} variant="secondary" size="sm">
            League Teams
          </LinkButton>
        </nav>
      </header>

      {snap.game.rematchCode && <RematchBanner code={snap.game.rematchCode} />}

      {!index ? (
        <div className="grid gap-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
          {isError && <p className="text-center text-sm text-red-300">Could not load the season. Reload the page to try again.</p>}
        </div>
      ) : (
        <FinishedGate code={code} info={info} viewing={viewing} isHost={isHost}>
          <ResultsContent snap={snap} info={info} me={me} index={index} viewing={viewing} isHost={isHost} onView={onView} />
        </FinishedGate>
      )}
    </main>
  );
}

export function RematchBanner({ code }: { code: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-pitch-500/15 px-4 py-3 ring-1 ring-pitch-500/30" role="status">
      <p className="text-sm font-medium">The host opened a rematch: same teams, a fresh auction.</p>
      <LinkButton to={`/lobby/${code}`} size="sm">
        Go to the rematch lobby
      </LinkButton>
    </div>
  );
}

/**
 * Results stay hidden until this viewer's playback reaches the final whistle. Only this gate follows the
 * clock, so the page under it does not re-render every tick.
 */
export function FinishedGate({
  code,
  info,
  viewing,
  isHost,
  subject = 'Awards, auction grades and head to head',
  children,
}: {
  code: string;
  info: SeasonInfo;
  viewing: number;
  isHost: boolean;
  /** What is waiting, e.g. "This team's season stats". */
  subject?: string;
  children: ReactNode;
}) {
  const p = usePlayback({ code, shared: info.playback, viewing, isHost });
  if (p.clock.finished) return children;
  return (
    <Card className="mx-auto max-w-lg text-center">
      <Trophy className="mx-auto size-10 text-gold" />
      <h2 className="mt-2 font-display text-2xl font-bold uppercase">Results at the final whistle</h2>
      <p className="mt-2 text-sm text-white/65">
        {subject} appear once season {viewing} has been played to the end
        {p.shared && !p.canControl ? '. The host is playing it now.' : '.'} Matchday {p.clock.matchday} of 38 so far.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <LinkButton to={`/season/${code}`}>Watch the season</LinkButton>
        {p.canControl && (
          <Button variant="secondary" onClick={p.end} loading={p.pending === 'playback-end'}>
            Skip to the end
          </Button>
        )}
      </div>
    </Card>
  );
}

const confettiKey = (code: string, n: number) => `dd:confetti:${code}:${n}`;

function ResultsContent({
  snap,
  info,
  me,
  index,
  viewing,
  isHost,
  onView,
}: {
  snap: GameSnapshot;
  info: SeasonInfo;
  me: UserView | null | undefined;
  index: SeasonIndex;
  viewing: number;
  isHost: boolean;
  onView: (n: number | null) => void;
}) {
  const code = snap.game.code;
  const q = useResults(code, viewing);
  const wide = useMediaQuery('(min-width: 1024px)');
  const [party, setParty] = useState(false);

  // One confetti burst per season per browser session.
  useEffect(() => {
    if (!q.data) return;
    try {
      if (sessionStorage.getItem(confettiKey(code, viewing))) return;
      sessionStorage.setItem(confettiKey(code, viewing), '1');
    } catch {
      // Storage blocked: celebrate anyway.
    }
    setParty(true);
  }, [q.data, code, viewing]);

  if (q.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (q.isError || !q.data) return <p className="text-center text-sm text-red-300">Could not load the results. Reload the page to try again.</p>;

  const results = q.data;
  const mine = snap.participants.find((x) => x.userId === me?.id);
  const myTeam = mine ? index.view.teams.find((t) => t.participantId === mine.id) : undefined;
  const myGrade = myTeam ? results.grades.find((g) => g.teamId === myTeam.id) : undefined;
  const final = index.view.standings.at(-1) ?? [];
  const champ = index.teams.get(index.view.championId);
  const champRow = final.find((r) => r.teamId === index.view.championId);

  const table = <LeagueTable index={index} completed={index.view.matchdays} code={code} finished compact={wide} />;
  const seasons = <SeasonsHistory code={code} info={info} viewing={viewing} isHost={isHost} hideLatest={false} onView={onView} />;
  const host = isHost ? <HostTools snap={snap} viewing={viewing} /> : null;

  return (
    <>
      <Confetti run={party} />
      <section className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]" aria-label="Season summary">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gold-400 px-4 py-3 text-ink shadow-lg shadow-gold-400/20">
          <Trophy className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest">Champions</p>
            <p className="truncate font-display text-2xl font-bold uppercase sm:text-3xl">{champ?.name}</p>
          </div>
          <p className="font-display text-xl font-semibold tabular-nums">{champRow?.points ?? 0} pts</p>
        </div>
        <ShareActions snap={snap} index={index} results={results} myTeamId={myTeam?.id ?? null} />
      </section>

      {myTeam && myGrade && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <TeamName team={myTeam} size="md" tag={false} className="font-display text-lg uppercase" />
            <p className="text-sm text-white/70">
              Finished <span className="font-semibold text-white">{ordinal(myGrade.finalPosition)}</span> with {final.find((r) => r.teamId === myTeam.id)?.points ?? 0} points
              {myGrade.bestBargain && ` · best bargain ${myGrade.bestBargain.name} at ${money(myGrade.bestBargain.priceM)}`}
            </p>
            <p className="ml-auto flex items-baseline gap-2">
              <span className="text-xs uppercase tracking-wide text-white/50">Your grade</span>
              <span className={cx('font-display text-3xl font-bold', GRADE_TEXT[gradeTone(myGrade.grade)])}>{myGrade.grade}</span>
            </p>
            <LinkButton to={`/team/${code}/${teamKey(myTeam)}?s=${viewing}`} variant="secondary" size="sm">
              Team page
            </LinkButton>
          </div>
        </Card>
      )}

      {wide ? (
        <>
          <div className="grid grid-cols-12 items-start gap-4">
            <div className="col-span-7 flex min-w-0 flex-col gap-4">
              <AwardsGrid index={index} results={results} />
              <TeamOfTheSeason index={index} results={results} />
            </div>
            <div className="col-span-5 min-w-0 lg:sticky lg:top-[4.25rem]">{table}</div>
          </div>
          <div className="mt-4">
            <AuctionGrades index={index} results={results} myTeamId={myTeam?.id ?? null} />
          </div>
          <div className="mt-4 grid grid-cols-2 items-start gap-4">
            <HeadToHead index={index} results={results} />
            <div className="flex flex-col gap-4">
              {seasons}
              {host}
            </div>
          </div>
        </>
      ) : (
        <SwipeTabs
          label="Results panels"
          tabs={[
            {
              id: 'awards',
              label: 'Awards',
              content: (
                <>
                  <AwardsGrid index={index} results={results} />
                  <TeamOfTheSeason index={index} results={results} />
                </>
              ),
            },
            { id: 'table', label: 'Table', content: table },
            { id: 'grades', label: 'Grades', content: <AuctionGrades index={index} results={results} myTeamId={myTeam?.id ?? null} /> },
            {
              id: 'more',
              label: 'More',
              content: (
                <>
                  <HeadToHead index={index} results={results} />
                  {seasons}
                  {host}
                </>
              ),
            },
          ]}
        />
      )}
    </>
  );
}

function ShareActions({ snap, index, results, myTeamId }: { snap: GameSnapshot; index: SeasonIndex; results: ResultsView; myTeamId: string | null }) {
  const [busy, setBusy] = useState(false);
  const url = `${window.location.origin}/results/${snap.game.code}?s=${results.number}`;

  const copy = async () => {
    const ok = await copyText(summaryText(index, results, snap.game.name, url));
    toast(ok ? 'Summary copied' : 'Could not copy. Select the text yourself.', ok ? 'success' : 'error');
  };

  const image = async () => {
    setBusy(true);
    try {
      const final = index.view.standings.at(-1) ?? [];
      const team = (id: string) => index.teams.get(id)!;
      const champRow = final.find((r) => r.teamId === index.view.championId);
      const mine = myTeamId ? results.grades.find((g) => g.teamId === myTeamId) : undefined;
      const a = results.awards;
      const awards = [
        a.goldenBoot && { label: 'Golden Boot', value: `${a.goldenBoot.name}, ${a.goldenBoot.value} goals` },
        a.playerOfTheSeason && { label: 'Player of the Season', value: `${a.playerOfTheSeason.name}, ${a.playerOfTheSeason.value.toFixed(2)}` },
        a.bestBuy && { label: 'Best Buy', value: `${a.bestBuy.name}, ${money(a.bestBuy.priceM)}` },
      ].filter((x): x is { label: string; value: string } => !!x);
      const blob = await seasonCardBlob({
        gameName: snap.game.name,
        season: results.number,
        champion: { ...team(index.view.championId), points: champRow?.points ?? 0 },
        myTeam: mine ? { ...team(mine.teamId), position: mine.finalPosition, points: final.find((r) => r.teamId === mine.teamId)?.points ?? 0, grade: mine.grade } : undefined,
        table: final.map((r) => ({ ...team(r.teamId), position: r.position, points: r.points, auction: team(r.teamId).kind !== 'ai' })),
        awards,
      });
      downloadBlob(blob, `deadline-day-${snap.game.code.toLowerCase()}-season-${results.number}.png`);
    } catch {
      toast('Could not make the image on this device', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch lg:justify-center">
      <Button variant="secondary" onClick={() => void copy()} className="flex-1 lg:flex-none">
        Copy summary
      </Button>
      <Button variant="secondary" onClick={() => void image()} loading={busy} className="flex-1 lg:flex-none">
        Download image
      </Button>
    </div>
  );
}

/** Host only: Rematch (new lobby, same teams) and Export. Run It Back sits in the Seasons card. */
function HostTools({ snap, viewing }: { snap: GameSnapshot; viewing: number }) {
  const code = snap.game.code;
  const navigate = useNavigate();
  const { run, pending } = useAction();
  const rematch = async () => {
    const res = await run('rematch', () => post<{ code: string }>(`/api/games/${code}/rematch`));
    if (res) void navigate(`/lobby/${res.code}`);
  };
  const base = `/api/games/${code}/export?number=${viewing}`;
  const files = [
    { label: 'Everything (JSON)', href: `${base}&format=json` },
    { label: 'Table (CSV)', href: `${base}&format=csv&table=table` },
    { label: 'Fixtures (CSV)', href: `${base}&format=csv&table=fixtures` },
    { label: 'Players (CSV)', href: `${base}&format=csv&table=players` },
    { label: 'Grades (CSV)', href: `${base}&format=csv&table=grades` },
  ];
  return (
    <Card>
      <CardTitle>Host tools</CardTitle>
      <div className="flex flex-col gap-4">
        <div>
          <Button onClick={() => void rematch()} loading={pending === 'rematch'} className="w-full sm:w-auto">
            {snap.game.rematchCode ? 'Open the rematch lobby' : 'Rematch'}
          </Button>
          <p className="mt-2 text-xs text-white/50">A new lobby with the same settings, managers and bots, ready for a fresh auction.</p>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Export season {viewing}</p>
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <a key={f.href} href={f.href} download className="inline-flex min-h-10 items-center rounded-xl bg-white/10 px-3 text-sm font-medium ring-1 ring-inset ring-white/10 hover:bg-white/15">
                {f.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
