import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExpectedStrengthView, MultiSeasonView, SeasonInfo } from '@deadline-day/protocol';
import { Button, Card, CardTitle, cx, Pill, Skeleton } from '../../components/ui';
import { useAction } from '../../hooks/useAction';
import { get, post } from '../../lib/api';
import { pct, type SeasonIndex } from '../../lib/season';
import { TeamName, Trophy } from './parts';

/** Bar colour: pitch-600, checked against the card surface (lightness band and 3:1 contrast). */
const BAR = '#179a53';

/** Expected Strength: average points over 1,000 simulated seasons, as a ranked bar table. */
export function ExpectedStrength({ code, index }: { code: string; index: SeasonIndex }) {
  const q = useQuery({
    queryKey: ['expected', code, index.view.number],
    queryFn: () => get<{ expected: ExpectedStrengthView }>(`/api/games/${code}/season/expected`).then((r) => r.expected),
    staleTime: Infinity,
  });
  const [open, setOpen] = useState<string | null>(null);
  const data = q.data;
  const max = data ? Math.max(10, Math.ceil(Math.max(...data.teams.map((t) => t.avgPoints)) / 20) * 20) : 100;
  const ticks = Array.from({ length: max / 20 + 1 }, (_, i) => i * 20);
  return (
    <Card>
      <CardTitle action={data && <Pill>{data.runs.toLocaleString()} seasons</Pill>}>Expected strength</CardTitle>
      <p className="-mt-1 mb-3 text-sm text-white/55">Average points if these 20 teams played the season again and again. Title, top four and bottom three are the share of seasons it happened.</p>
      {q.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <p className="text-sm text-white/50">Simulating 1,000 seasons...</p>
          <Skeleton className="h-64" />
        </div>
      ) : q.isError || !data ? (
        <p className="text-sm text-red-300">Could not run the simulation. Try again later.</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="whitespace-nowrap text-left text-[0.7rem] uppercase tracking-wide text-white/45">
              <th className="py-1 font-medium">Team</th>
              <th className="hidden w-[38%] py-1 font-medium sm:table-cell">
                <span className="relative block h-4" aria-hidden="true">
                  {ticks.map((t) => (
                    <span key={t} className="absolute -translate-x-1/2 text-[0.65rem] font-normal normal-case text-white/40" style={{ left: `${(t / max) * 100}%` }}>
                      {t}
                    </span>
                  ))}
                </span>
                <span className="sr-only">Average points (bar)</span>
              </th>
              <th className="w-12 py-1 text-right font-medium">Pts</th>
              <th className="w-14 py-1 text-right font-medium">Title</th>
              <th className="hidden w-16 py-1 text-right font-medium md:table-cell">Top 4</th>
              <th className="hidden w-20 py-1 text-right font-medium md:table-cell">Bottom 3</th>
            </tr>
          </thead>
          <tbody>
            {data.teams.map((r) => {
              const team = index.teams.get(r.teamId);
              const expanded = open === r.teamId;
              return (
                <tr
                  key={r.teamId}
                  onClick={() => setOpen(expanded ? null : r.teamId)}
                  className={cx('cursor-pointer border-t border-white/5 hover:bg-white/5', team?.kind !== 'ai' && 'bg-gold-400/[0.06]')}
                >
                  <td className="max-w-0 py-1.5 pr-2">
                    <TeamName team={team} />
                    {expanded && (
                      <span className="mt-1 block text-xs text-white/60 md:hidden">
                        Top 4 {pct(r.top4Chance)} · Bottom 3 {pct(r.bottom3Chance)} · Avg finish {r.avgPosition.toFixed(1)}
                      </span>
                    )}
                  </td>
                  <td className="hidden py-1.5 sm:table-cell">
                    <span className="relative block h-3.5" title={`${team?.name}: ${r.avgPoints} points on average`}>
                      {ticks.map((t) => (
                        <span key={t} className="absolute inset-y-[-6px] w-px bg-white/[0.07]" style={{ left: `${(t / max) * 100}%` }} aria-hidden="true" />
                      ))}
                      <span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${(r.avgPoints / max) * 100}%`, background: BAR }} />
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-display font-semibold">{r.avgPoints.toFixed(1)}</td>
                  <td className="py-1.5 text-right">{pct(r.titleChance)}</td>
                  <td className="hidden py-1.5 text-right text-white/70 md:table-cell">{pct(r.top4Chance)}</td>
                  <td className="hidden py-1.5 text-right text-white/70 md:table-cell">{pct(r.bottom3Chance)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Simulate 2 to 10 more seasons with the same teams and count the titles. Nothing is saved. */
export function MultiSeason({ code, index }: { code: string; index: SeasonIndex }) {
  const [count, setCount] = useState(5);
  const [request, setRequest] = useState<{ seasons: number; run: number } | null>(null);
  const q = useQuery({
    queryKey: ['multi', code, index.view.number, request?.seasons, request?.run],
    queryFn: () => get<{ multi: MultiSeasonView }>(`/api/games/${code}/season/multi?seasons=${request!.seasons}&run=${request!.run}`).then((r) => r.multi),
    enabled: request !== null,
    staleTime: Infinity,
  });
  const data = q.data;
  return (
    <Card>
      <CardTitle>Multi-season</CardTitle>
      <p className="-mt-1 mb-3 text-sm text-white/55">Play the same 20 teams for several seasons in a row and count the titles. For fun only: it does not change your game.</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-night-950/60 p-1 ring-1 ring-white/10">
          <button type="button" className="grid size-9 place-items-center rounded-lg text-lg hover:bg-white/10 disabled:opacity-40" onClick={() => setCount((c) => Math.max(2, c - 1))} disabled={count <= 2} aria-label="Fewer seasons">
            -
          </button>
          <span className="w-24 text-center text-sm font-semibold tabular-nums" aria-live="polite">
            {count} seasons
          </span>
          <button type="button" className="grid size-9 place-items-center rounded-lg text-lg hover:bg-white/10 disabled:opacity-40" onClick={() => setCount((c) => Math.min(10, c + 1))} disabled={count >= 10} aria-label="More seasons">
            +
          </button>
        </div>
        <Button onClick={() => setRequest({ seasons: count, run: (request?.run ?? 0) + 1 })} loading={q.isFetching}>
          {request ? 'Run again' : 'Simulate'}
        </Button>
      </div>
      {data && (
        <div className="mt-4 flex flex-col gap-4">
          <ol className="flex flex-wrap gap-1.5">
            {data.champions.map((c) => (
              <li key={c.season} className="flex items-center gap-1.5 rounded-lg bg-night-950/50 px-2 py-1 text-xs ring-1 ring-white/5">
                <span className="text-white/45">S{c.season}</span>
                <Trophy className="size-3.5 text-gold" />
                <span className="font-semibold">{index.teams.get(c.teamId)?.name}</span>
                <span className="text-white/45">{c.points} pts</span>
              </li>
            ))}
          </ol>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[0.7rem] uppercase tracking-wide text-white/45">
                <th className="py-1 font-medium">Team</th>
                <th className="w-14 py-1 text-right font-medium">Titles</th>
                <th className="w-16 py-1 text-right font-medium">Avg pts</th>
                <th className="hidden w-16 py-1 text-right font-medium sm:table-cell">Avg pos</th>
                <th className="hidden w-12 py-1 text-right font-medium sm:table-cell">Best</th>
              </tr>
            </thead>
            <tbody>
              {data.titles.slice(0, 10).map((r) => (
                <tr key={r.teamId} className="border-t border-white/5">
                  <td className="max-w-0 py-1.5 pr-2">
                    <TeamName team={index.teams.get(r.teamId)} />
                  </td>
                  <td className="py-1.5 text-right font-display font-semibold">{r.titles}</td>
                  <td className="py-1.5 text-right">{r.avgPoints.toFixed(1)}</td>
                  <td className="hidden py-1.5 text-right text-white/70 sm:table-cell">{r.avgPosition.toFixed(1)}</td>
                  <td className="hidden py-1.5 text-right text-white/70 sm:table-cell">{r.bestFinish}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-white/45">Top 10 by titles, then average finish.</p>
        </div>
      )}
    </Card>
  );
}

/** Every season this game has played, and Run It Back for the host. */
export function SeasonsHistory({
  code,
  info,
  viewing,
  isHost,
  hideLatest,
  onView,
}: {
  code: string;
  info: SeasonInfo;
  viewing: number;
  isHost: boolean;
  /** The latest season is still being played back: keep its champion secret. */
  hideLatest: boolean;
  onView: (n: number | null) => void;
}) {
  const { run, pending } = useAction();
  const [armed, setArmed] = useState(false);
  const latest = info.seasons.at(-1)!.number;
  const rerun = async () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    const res = await run('rerun', () => post(`/api/games/${code}/season/rerun`), 'New season simulated');
    if (res) onView(null);
  };
  return (
    <Card>
      <CardTitle action={<Pill>{info.seasons.length}</Pill>}>Seasons</CardTitle>
      <ol className="flex flex-col divide-y divide-white/5">
        {[...info.seasons].reverse().map((s) => (
          <li key={s.number} className="flex items-center gap-3 py-2 text-sm">
            <span className="w-20 shrink-0 font-display font-semibold uppercase">Season {s.number}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-white/75">
              <Trophy className="size-4 shrink-0 text-gold" />
              <span className="truncate">{s.number === latest && hideLatest ? 'Champion revealed at the final whistle' : s.championName}</span>
            </span>
            {s.number === viewing ? (
              <Pill tone="green">Showing</Pill>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => onView(s.number === latest ? null : s.number)}>
                View
              </Button>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-3 border-t border-white/10 pt-3">
        {isHost ? (
          <>
            <Button variant={armed ? 'gold' : 'primary'} onClick={() => void rerun()} loading={pending === 'rerun'} className="w-full sm:w-auto">
              {armed ? 'Tap again: same teams, new seed' : 'Run It Back'}
            </Button>
            <p className="mt-2 text-xs text-white/50">Plays a new season with the same 20 teams and a new seed. Earlier seasons stay here.</p>
          </>
        ) : (
          <p className="text-xs text-white/50">The host can Run It Back: a new season with the same teams and a new seed.</p>
        )}
      </div>
    </Card>
  );
}
