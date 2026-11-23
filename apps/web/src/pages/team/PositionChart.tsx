import { useRef, useState } from 'react';
import type { FixtureView, TeamReportView } from '@deadline-day/protocol';
import { cx } from '../../components/ui';
import { ordinal, type SeasonIndex } from '../../lib/season';

/** Same single-series colour as the Expected Strength bars (validated against the card surface). */
const LINE = '#179a53';
const RESULT_CLASS: Record<string, string> = {
  W: 'bg-pitch-500 text-ink',
  D: 'bg-white/25 text-white',
  L: 'bg-red-500/80 text-snow',
};

/** League position after every matchday (1st at the top), with a hover crosshair, plus the W/D/L strip. */
export function PositionChart({ index, report, teamId }: { index: SeasonIndex; report: TeamReportView; teamId: string }) {
  const n = report.positions.length;
  const teams = index.view.teams.length;
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (n === 0) return null;

  const xPct = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const yPct = (pos: number) => ((pos - 1) / (teams - 1)) * 100;
  const points = report.positions.map((p, i) => `${(xPct(i) / 100) * (n - 1)},${p - 1}`).join(' ');
  const ticks = [1, 5, 10, 15, teams];

  const games = index.view.fixtures.filter((f) => f.homeId === teamId || f.awayId === teamId).sort((a, b) => a.matchday - b.matchday);
  const describe = (i: number) => {
    const f: FixtureView | undefined = games[i];
    const pos = report.positions[i]!;
    if (!f) return `MD ${i + 1}: ${ordinal(pos)}`;
    const home = f.homeId === teamId;
    const opp = index.teams.get(home ? f.awayId : f.homeId)?.name ?? '?';
    const gf = home ? f.homeGoals : f.awayGoals;
    const ga = home ? f.awayGoals : f.homeGoals;
    return `MD ${f.matchday}: ${ordinal(pos)} · ${report.results[i]} ${gf}-${ga} ${home ? 'v' : 'at'} ${opp}`;
  };

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative h-44 w-9 shrink-0 text-right text-[0.65rem] text-white/45" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${yPct(t)}%` }}>
              {ordinal(t)}
            </span>
          ))}
        </div>
        <div ref={box} className="relative h-44 flex-1 touch-none" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <span key={t} className="absolute inset-x-0 h-px bg-white/[0.07]" style={{ top: `${yPct(t)}%` }} aria-hidden="true" />
          ))}
          <svg viewBox={`0 0 ${Math.max(1, n - 1)} ${teams - 1}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
            <polyline points={points} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {hover !== null && (
            <>
              <span className="pointer-events-none absolute inset-y-0 w-px bg-white/30" style={{ left: `${xPct(hover)}%` }} aria-hidden="true" />
              <span
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-night-800"
                style={{ left: `${xPct(hover)}%`, top: `${yPct(report.positions[hover]!)}%`, background: LINE }}
                aria-hidden="true"
              />
              <span
                className={cx(
                  'pointer-events-none absolute -top-2 z-10 max-w-[14rem] -translate-y-full whitespace-nowrap rounded-lg bg-night-950 px-2 py-1 text-xs shadow-lg ring-1 ring-white/10',
                  xPct(hover) > 60 ? '-translate-x-full' : '',
                )}
                style={{ left: `${xPct(hover)}%` }}
                role="status"
              >
                {describe(hover)}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="ml-11 flex justify-between text-[0.65rem] text-white/45" aria-hidden="true">
        <span>MD 1</span>
        <span>MD {Math.ceil(n / 2)}</span>
        <span>MD {n}</span>
      </div>
      <figcaption className="sr-only">
        League position after each matchday: started {ordinal(report.positions[0]!)}, finished {ordinal(report.positions[n - 1]!)}, best {ordinal(Math.min(...report.positions))}.
      </figcaption>
      <ol className="ml-11 grid grid-cols-[repeat(19,minmax(0,1fr))] gap-0.5 sm:grid-cols-[repeat(38,minmax(0,1fr))]" aria-label="Result on each matchday">
        {report.results.map((r, i) => (
          <li key={i} className={cx('grid h-4 place-items-center rounded-sm text-[0.55rem] font-bold', RESULT_CLASS[r])} title={describe(i)}>
            {r}
          </li>
        ))}
      </ol>
    </figure>
  );
}
