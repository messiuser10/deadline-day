import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FORMATION_IDS, MAX_TEAMS, MIN_TEAMS, type SimParams } from '@deadline-day/engine';
import type { LabResult, LabTeamsView, TestAuctionResult } from '@deadline-day/protocol';
import { errorMessage, get, post } from '../../lib/api';
import { money } from '../../lib/format';
import { Button, Card, CardTitle, cx, ErrorText, Field, Input, Pill, Segmented, Skeleton, Toggle } from '../../components/ui';
import { AdminHeader, Histogram, NumberInput, pct, Select, StatTile, useAdminMutation } from './parts';
import { useAdminSettings } from './Settings';

const randomSeed = () => Math.floor(Math.random() * 4294967296);
type LabParams = Pick<SimParams, 'baseGoals' | 'homeAdvantage' | 'sensitivity' | 'chaos' | 'chemistry' | 'injuries'>;
const pickParams = (p: SimParams): LabParams => ({ baseGoals: p.baseGoals, homeAdvantage: p.homeAdvantage, sensitivity: p.sensitivity, chaos: p.chaos, chemistry: p.chemistry, injuries: p.injuries });

function TestAuction() {
  const [teams, setTeams] = useState(6);
  const [botLevel, setBotLevel] = useState<'mixed' | 'easy' | 'medium' | 'hard'>('mixed');
  const [formation, setFormation] = useState<string>('mixed');
  const [result, setResult] = useState<TestAuctionResult | null>(null);
  const run = useAdminMutation(async () => (await post<{ result: TestAuctionResult }>('/api/admin/lab/test-auction', { teams, botLevel, formation })).result, {
    invalidate: [['admin', 'games'], ['admin', 'overview']],
    onSuccess: setResult,
  });
  return (
    <Card>
      <CardTitle>Test Auction</CardTitle>
      <p className="-mt-1 mb-3 text-xs text-white/50">Creates a private test game with N bots, fast-forwards the auction, simulates the season and reports the numbers. Test games never reach the Hall of Fame or leaderboard.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={`Bots: ${teams}`}>
          {(id) => <input id={id} type="range" min={MIN_TEAMS} max={MAX_TEAMS} value={teams} onChange={(e) => setTeams(Number(e.target.value))} className="h-11 w-full accent-pitch-500" />}
        </Field>
        <Field label="Bot level">
          {(id) => (
            <Select id={id} value={botLevel} onChange={(e) => setBotLevel(e.target.value as typeof botLevel)}>
              <option value="mixed">Mixed</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          )}
        </Field>
        <Field label="Formation">
          {(id) => (
            <Select id={id} value={formation} onChange={(e) => setFormation(e.target.value)}>
              <option value="mixed">Mixed</option>
              {FORMATION_IDS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Button className="mt-3 w-full sm:w-auto" onClick={() => run.mutate(undefined)} loading={run.isPending}>
        {run.isPending ? 'Running the auction…' : 'Run test auction'}
      </Button>
      {result && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Pool size" value={result.poolSize} hint={`${result.unsold} unsold`} />
            <StatTile label="Total spent" value={money(result.totalSpentM)} hint={`${result.lots} lots · ${result.bids} bids`} />
            <StatTile label="Biggest price" value={result.biggest ? money(result.biggest.priceM) : '–'} hint={result.biggest ? `${result.biggest.name}, ${result.biggest.teamName}` : undefined} />
            <StatTile label="Smallest price" value={result.smallest ? money(result.smallest.priceM) : '–'} hint={result.smallest ? `${result.smallest.name}, ${result.smallest.teamName}` : undefined} />
          </div>
          <p className="text-sm text-white/70">
            Champions: <span className="font-semibold text-gold-400">{result.championName ?? '–'}</span> · took {(result.ms / 1000).toFixed(1)} s ·{' '}
            <Link to={`/admin/games/${result.code}`} className="text-pitch-400 hover:underline">
              open game {result.code}
            </Link>
          </p>
        </div>
      )}
    </Card>
  );
}

function Results({ r }: { r: LabResult }) {
  const many = r.runs > 1;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Goals per match" value={r.goalsPerMatch.toFixed(2)} />
        <StatTile label="Home wins" value={pct(r.homeWinRate, 1)} />
        <StatTile label="Draws" value={pct(r.drawRate, 1)} />
        <StatTile label="Away wins" value={pct(r.awayWinRate, 1)} />
      </div>
      <div className={cx('grid gap-3', many && 'md:grid-cols-3')}>
        <Histogram title={many ? 'Goals per match, by season' : 'Total goals in each of the 380 matches'} dist={r.goals} unit="Goals" integer={!many} format={(n) => (many ? n.toFixed(2) : String(n))} />
        {many && (
          <>
            <Histogram title="Points spread (1st minus 20th)" dist={r.pointsSpread} unit="Points" integer />
            <Histogram title="Champion's points" dist={r.championPoints} unit="Points" integer />
          </>
        )}
      </div>
      {!many && (
        <p className="text-xs text-white/50">
          Champions on {r.championPoints.max} points, {r.pointsSpread.max} ahead of the bottom team. Run 100 or 1,000 seasons to see the spread as a distribution.
        </p>
      )}
      <Card className="!p-0 sm:!p-0">
        <table className="w-full table-fixed text-sm tabular-nums">
          <caption className="px-3 pt-3 text-left text-xs text-white/50 sm:px-4">
            {many ? `Averages over ${r.runs.toLocaleString()} seasons, seed ${r.seed}` : `Final table, seed ${r.seed}`} · {r.ms} ms
          </caption>
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wide text-white/45">
              <th className="w-9 py-2 pl-3 font-medium sm:pl-4" scope="col">#</th>
              <th className="py-2 font-medium" scope="col">Team</th>
              {many ? (
                <>
                  <th className="w-14 py-2 text-right font-medium" scope="col">Pts</th>
                  <th className="w-14 py-2 text-right font-medium" scope="col">Title</th>
                  <th className="hidden w-16 whitespace-nowrap py-2 text-right font-medium sm:table-cell" scope="col">Top 4</th>
                  <th className="w-16 whitespace-nowrap py-2 pr-3 text-right font-medium sm:w-20 sm:pr-4" scope="col" title="Bottom three">Btm 3</th>
                </>
              ) : (
                <>
                  <th className="hidden w-24 py-2 text-right font-medium sm:table-cell" scope="col">W-D-L</th>
                  <th className="w-16 py-2 text-right font-medium" scope="col">GD</th>
                  <th className="w-12 py-2 pr-3 text-right font-medium sm:pr-4" scope="col">Pts</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {r.teams.map((t, i) => (
              <tr key={t.id} className="border-t border-white/5">
                <td className="py-1.5 pl-3 text-white/60 sm:pl-4">{many ? t.avgPosition.toFixed(1) : t.last.position}</td>
                <td className="truncate py-1.5 pr-2 font-medium">{t.name}</td>
                {many ? (
                  <>
                    <td className="py-1.5 text-right">{t.avgPoints.toFixed(1)}</td>
                    <td className={cx('py-1.5 text-right', i === 0 && 'font-semibold text-gold-400')}>{pct(t.titleChance, 1)}</td>
                    <td className="hidden py-1.5 text-right sm:table-cell">{pct(t.top4Chance)}</td>
                    <td className="py-1.5 pr-3 text-right text-white/70 sm:pr-4">{pct(t.bottom3Chance)}</td>
                  </>
                ) : (
                  <>
                    <td className="hidden py-1.5 text-right text-white/70 sm:table-cell">
                      {t.last.won}-{t.last.drawn}-{t.last.lost}
                    </td>
                    <td className="py-1.5 text-right">{t.last.goalsFor - t.last.goalsAgainst > 0 ? '+' : ''}{t.last.goalsFor - t.last.goalsAgainst}</td>
                    <td className="py-1.5 pr-3 text-right font-display text-base font-bold sm:pr-4">{t.last.points}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function LabTab() {
  const settings = useAdminSettings();
  const [gameCode, setGameCode] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);
  const teamsQ = useQuery({
    queryKey: ['admin', 'lab', 'teams', loaded],
    queryFn: () => get<LabTeamsView>(`/api/admin/lab/teams${loaded ? `?game=${encodeURIComponent(loaded)}` : ''}`),
    retry: false,
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [seed, setSeed] = useState<number | null>(() => randomSeed());
  const [runs, setRuns] = useState<'1' | '100' | '1000'>('1');
  const [params, setParams] = useState<LabParams | null>(null);
  const [result, setResult] = useState<LabResult | null>(null);

  useEffect(() => {
    if (settings.data && !params) setParams(pickParams(settings.data.settings.sim_params));
  }, [settings.data, params]);
  useEffect(() => {
    const view = teamsQ.data;
    if (!view) return;
    if (view.game) {
      setPicked(view.game.teamIds);
      setSeed(view.game.seed);
    } else setPicked((p) => (p.length ? p.filter((id) => view.teams.some((t) => t.id === id)) : view.teams.filter((t) => t.source === 'club').map((t) => t.id)));
  }, [teamsQ.data]);

  const run = useAdminMutation(async () => (await post<{ result: LabResult }>('/api/admin/lab/run', { teamIds: picked, seed, runs: Number(runs), params })).result, { onSuccess: setResult });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 20 ? p : [...p, id]));
  const loadError = teamsQ.error ? errorMessage(teamsQ.error) : null;

  if (settings.isPending || !params) return <Skeleton className="h-96" />;
  const groups = [
    { label: 'Clubs', teams: teamsQ.data?.teams.filter((t) => t.source === 'club') ?? [] },
    { label: teamsQ.data?.game ? `${teamsQ.data.game.name} (season ${teamsQ.data.game.seasonNumber})` : '', teams: teamsQ.data?.teams.filter((t) => t.source === 'game') ?? [] },
  ].filter((g) => g.teams.length);
  const setP = <K extends keyof LabParams>(k: K, v: LabParams[K]) => setParams({ ...params, [k]: v });

  return (
    <>
      <AdminHeader title="Simulation Lab" description="Run any 20 teams for one season or a Monte Carlo of up to 1,000, with any seed and parameters. Nothing here is saved." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Teams ({picked.length} of 20)</CardTitle>
            <form
              className="mb-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setLoaded(gameCode.trim().toUpperCase() || null);
              }}
            >
              <Input aria-label="Game code" placeholder="Load a game by code" value={gameCode} maxLength={8} onChange={(e) => setGameCode(e.target.value)} className="uppercase" />
              <Button type="submit" variant="secondary" size="md">
                Load
              </Button>
            </form>
            {loaded && (
              <p className="mb-2 flex items-center gap-2 text-xs text-white/60">
                {teamsQ.data?.game ? `Loaded ${teamsQ.data.game.code}: its 20 teams and seed are picked.` : null}
                <button type="button" className="text-pitch-400 hover:underline" onClick={() => (setLoaded(null), setGameCode(''), setPicked([]))}>
                  Clubs only
                </button>
              </p>
            )}
            <ErrorText>{loadError}</ErrorText>
            <div className="mb-2 flex gap-2 text-xs">
              <button type="button" className="text-pitch-400 hover:underline" onClick={() => setPicked((teamsQ.data?.teams.filter((t) => t.source === 'club') ?? []).map((t) => t.id))}>
                All 20 clubs
              </button>
              <button type="button" className="text-white/60 hover:underline" onClick={() => setPicked([])}>
                Clear
              </button>
            </div>
            {teamsQ.isPending ? (
              <Skeleton className="h-60" />
            ) : (
              <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
                {groups.map((g) => (
                  <fieldset key={g.label}>
                    <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/45">{g.label}</legend>
                    <ul className="flex flex-col">
                      {g.teams.map((t) => {
                        const on = picked.includes(t.id);
                        return (
                          <li key={t.id}>
                            <label className={cx('flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-white/5', !on && picked.length >= 20 && 'opacity-40')}>
                              <input type="checkbox" checked={on} onChange={() => toggle(t.id)} className="size-4 accent-pitch-500" />
                              <span className="size-3 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate">{t.name}</span>
                              {t.kind !== 'ai' && <Pill>{t.kind}</Pill>}
                              <span className="shrink-0 text-xs tabular-nums text-white/45" title="Attack / defence">
                                {t.attack.toFixed(0)}/{t.defense.toFixed(0)}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Run</CardTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Seed">
                {(id) => (
                  <span className="flex gap-2">
                    <NumberInput id={id} value={seed} min={0} max={4294967295} onChange={setSeed} />
                    <Button variant="secondary" onClick={() => setSeed(randomSeed())}>
                      New
                    </Button>
                  </span>
                )}
              </Field>
              <Field label="Seasons">
                {() => (
                  <Segmented
                    label="Seasons"
                    value={runs}
                    onChange={setRuns}
                    options={[
                      { value: '1', label: '1' },
                      { value: '100', label: '100' },
                      { value: '1000', label: '1,000' },
                    ]}
                  />
                )}
              </Field>
              <Field label="Base goals">{(id) => <NumberInput id={id} value={params.baseGoals} min={0.3} max={4} step={0.05} onChange={(v) => v !== null && setP('baseGoals', v)} />}</Field>
              <Field label="Home advantage">{(id) => <NumberInput id={id} value={params.homeAdvantage} min={0.7} max={1.6} step={0.01} onChange={(v) => v !== null && setP('homeAdvantage', v)} />}</Field>
              <Field label="Sensitivity">{(id) => <NumberInput id={id} value={params.sensitivity} min={0} max={0.5} step={0.005} onChange={(v) => v !== null && setP('sensitivity', v)} />}</Field>
              <Field label="Chaos">{(id) => <NumberInput id={id} value={params.chaos} min={0} max={1} step={0.05} onChange={(v) => v !== null && setP('chaos', v)} />}</Field>
              <Toggle checked={params.chemistry} onChange={(v) => setP('chemistry', v)} label="Chemistry" />
              <Toggle checked={params.injuries} onChange={(v) => setP('injuries', v)} label="Injuries" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={() => run.mutate(undefined)} loading={run.isPending} disabled={picked.length !== 20 || seed === null}>
                {picked.length === 20 ? `Simulate ${runs === '1' ? 'a season' : `${Number(runs).toLocaleString()} seasons`}` : `Pick ${20 - picked.length > 0 ? `${20 - picked.length} more` : '20'} teams`}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setParams(pickParams(settings.data!.settings.sim_params))}>
                Use current settings
              </Button>
            </div>
          </Card>
          {result ? <Results r={result} /> : <p className="rounded-xl bg-night-950/40 px-4 py-6 text-center text-sm text-white/50">Pick 20 teams and run a season to see the numbers.</p>}
          <TestAuction />
        </div>
      </div>
    </>
  );
}
