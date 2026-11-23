import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { TrophyKind } from '@deadline-day/protocol';
import { cx } from '../../components/ui';
import { GRADE_TEXT, gradeTone, type Grade } from '../../lib/results';
import { Trophy } from '../season/parts';

export const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Grade letter on a chip; the letter carries the meaning, the colour only helps. */
export function GradeChip({ grade, className }: { grade: Grade; className?: string }) {
  return (
    <span className={cx('inline-grid min-w-8 place-items-center rounded-lg bg-white/5 px-1.5 py-0.5 font-display font-bold ring-1 ring-white/10', GRADE_TEXT[gradeTone(grade)], className)} aria-label={`Grade ${grade}`}>
      {grade}
    </span>
  );
}

/** Links to the official (season 1) results when the viewer may see the game; private games stay plain text. */
export function GameLink({ code, className, children }: { code: string | null; className?: string; children: ReactNode }) {
  if (!code) return <div className={className}>{children}</div>;
  return (
    <Link to={`/results/${code}?s=1`} className={cx('block hover:ring-pitch-400/50', className)}>
      {children}
    </Link>
  );
}

export const TROPHY_LABEL: Record<TrophyKind, string> = {
  title: 'League title',
  golden_boot: 'Golden Boot',
  playmaker: 'Playmaker',
  golden_glove: 'Golden Glove',
  player_of_the_season: 'Player of the Season',
  best_buy: 'Best Buy',
};

const PATH: Partial<Record<TrophyKind, string>> = {
  golden_boot: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3 3 2.2-1.1 3.5h-3.8L9 7.2 12 5Z',
  playmaker: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3 3 2.2-1.1 3.5h-3.8L9 7.2 12 5Z',
  golden_glove: 'M7 4a1.5 1.5 0 0 1 3 0v6h1V3a1.5 1.5 0 0 1 3 0v7h1V5a1.5 1.5 0 0 1 3 0v9a7 7 0 0 1-7 7h-1a6 6 0 0 1-5.6-3.9L3.6 12a1.5 1.5 0 0 1 2.7-1.2L7 12V4Z',
  player_of_the_season: 'm12 2 2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7L12 2Z',
  best_buy: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Zm4-5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
};

export function TrophyIcon({ kind, className }: { kind: TrophyKind; className?: string }) {
  if (kind === 'title') return <Trophy className={className} />;
  return (
    <svg viewBox="0 0 24 24" className={cx('size-5', className)} fill="currentColor" aria-hidden="true">
      <path d={PATH[kind]} />
    </svg>
  );
}
