import { Link } from 'react-router';
import type { TableBand, TableBandTone } from '@deadline-day/protocol';
import { Card, CardTitle, cx, Pill } from '../../components/ui';
import { movement, tableAfter, teamKey, type SeasonIndex } from '../../lib/season';
import { FormGuide, TeamName, Trophy } from './parts';

const BAND_BAR: Record<TableBandTone, string> = {
  gold: 'bg-gold-400',
  green: 'bg-pitch-500',
  blue: 'bg-sky-400',
  red: 'bg-red-500',
};

function bandFor(bands: TableBand[], position: number): TableBand | undefined {
  return bands.find((b) => b.enabled && position >= b.from && position <= b.to);
}

/** The table after `completed` matchdays, with movement arrows, form and the colour bands (labelled below). */
export function LeagueTable({ index, completed, code, finished, compact = false }: { index: SeasonIndex; completed: number; code: string; finished: boolean; compact?: boolean }) {
  const rows = tableAfter(index, completed);
  const bands = index.view.bands.filter((b) => b.enabled);
  return (
    <Card>
      <CardTitle action={<Pill>{completed === 0 ? 'Pre-season' : finished ? 'Final' : `After matchday ${completed}`}</Pill>}>Table</CardTitle>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[19rem] text-sm tabular-nums">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wide text-white/45">
              <th className="w-12 py-1 pl-2 font-medium">Pos</th>
              <th className="py-1 font-medium">Team</th>
              <th className="w-7 py-1 text-right font-medium">P</th>
              {!compact && <th className="hidden w-7 py-1 text-right font-medium sm:table-cell">W</th>}
              {!compact && <th className="hidden w-7 py-1 text-right font-medium sm:table-cell">D</th>}
              {!compact && <th className="hidden w-7 py-1 text-right font-medium sm:table-cell">L</th>}
              <th className="w-9 py-1 text-right font-medium">GD</th>
              <th className="w-9 py-1 pr-2 text-right font-medium">Pts</th>
              <th className="hidden w-24 py-1 pl-3 font-medium xl:table-cell">Form</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const team = index.teams.get(r.teamId);
              const band = completed > 0 ? bandFor(bands, r.position) : undefined;
              const move = movement(index, completed, r.teamId);
              const champion = finished && r.position === 1;
              return (
                <tr key={r.teamId} className={cx('border-t border-white/5', team?.kind !== 'ai' && 'bg-gold-400/[0.06]')}>
                  <td className="relative py-1.5 pl-2">
                    {band && <span className={cx('absolute inset-y-1 left-0 w-1 rounded-full', BAND_BAR[band.tone])} title={band.label} />}
                    <span className="inline-flex items-center gap-1">
                      <span className="w-5 text-right font-display">{r.position}</span>
                      <Move value={move} />
                    </span>
                  </td>
                  <td className="max-w-0 py-1.5">
                    <Link to={`/team/${code}/${team ? teamKey(team) : r.teamId}?s=${index.view.number}`} className="flex min-w-0 items-center gap-1.5 hover:underline">
                      <TeamName team={team} tag="wide" />
                      {champion && <Trophy className="shrink-0 text-gold" />}
                    </Link>
                  </td>
                  <td className="py-1.5 text-right text-white/70">{r.played}</td>
                  {!compact && <td className="hidden py-1.5 text-right text-white/70 sm:table-cell">{r.won}</td>}
                  {!compact && <td className="hidden py-1.5 text-right text-white/70 sm:table-cell">{r.drawn}</td>}
                  {!compact && <td className="hidden py-1.5 text-right text-white/70 sm:table-cell">{r.lost}</td>}
                  <td className="py-1.5 text-right text-white/70">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
                  <td className="py-1.5 pr-2 text-right font-display text-base font-bold">{r.points}</td>
                  <td className="hidden py-1.5 pl-3 xl:table-cell">
                    <FormGuide form={r.form} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
        <li className="flex items-center gap-1.5 sm:hidden">
          <span className="font-semibold text-white">Bold</span> on a tinted row: auction team
        </li>
        {completed > 0 &&
          bands.map((b) => (
            <li key={`${b.from}-${b.to}`} className="flex items-center gap-1.5">
              <span className={cx('h-3 w-1 rounded-full', BAND_BAR[b.tone])} aria-hidden="true" />
              {b.label} ({b.from === b.to ? b.from : `${b.from}-${b.to}`})
            </li>
          ))}
      </ul>
    </Card>
  );
}

function Move({ value }: { value: number }) {
  if (value === 0) return <span className="w-5 text-center text-[0.6rem] text-white/25" aria-hidden="true">-</span>;
  const up = value > 0;
  return (
    <span className={cx('flex w-5 items-center text-[0.65rem] font-semibold', up ? 'text-pitch-400' : 'text-red-400')} aria-label={up ? `up ${value}` : `down ${-value}`}>
      <svg viewBox="0 0 10 10" className="size-2.5" fill="currentColor" aria-hidden="true">
        <path d={up ? 'M5 1l4 6H1z' : 'M5 9L1 3h8z'} />
      </svg>
      {Math.abs(value)}
    </span>
  );
}
