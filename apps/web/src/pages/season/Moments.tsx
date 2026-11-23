import { FULL_TIME, type KeyMomentView, type MatchClock } from '@deadline-day/protocol';
import { Card, CardTitle, cx, Pill } from '../../components/ui';
import { MOMENT_LABEL, momentText, type SeasonIndex } from '../../lib/season';

const TONE: Record<KeyMomentView['kind'], string> = {
  auction_derby: 'bg-gold-400/15 text-gold-400',
  hat_trick: 'bg-pitch-500/15 text-pitch-400',
  big_win: 'bg-sky-400/15 text-sky-300',
  upset: 'bg-red-500/15 text-red-300',
  new_leader: 'bg-white/10 text-white/80',
};

/** Moments that have happened by the clock, newest first. */
export function visibleMoments(index: SeasonIndex, clock: MatchClock): KeyMomentView[] {
  return index.view.moments
    .filter((m) => m.matchday < clock.matchday || (m.matchday === clock.matchday && (clock.fullTime ? true : m.minute <= clock.minute)))
    .reverse();
}

export function MomentsFeed({ index, clock, onOpen, limit }: { index: SeasonIndex; clock: MatchClock; onOpen: (fixtureId: number) => void; limit?: number }) {
  const all = visibleMoments(index, clock);
  const list = limit ? all.slice(0, limit) : all;
  return (
    <Card>
      <CardTitle action={<Pill>{all.length}</Pill>}>Key moments</CardTitle>
      {list.length === 0 ? (
        <p className="py-4 text-center text-sm text-white/50">Hat-tricks, upsets, big wins and new leaders appear here as the season unfolds.</p>
      ) : (
        <ol className="flex flex-col gap-1.5" aria-live="polite">
          {list.map((m) => {
            const final = m.matchday < clock.matchday || clock.fullTime;
            const body = (
              <>
                <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide', TONE[m.kind])}>{MOMENT_LABEL[m.kind]}</span>
                <span className="min-w-0 flex-1">{momentText(index, m, final)}</span>
                <span className="shrink-0 text-xs text-white/45 tabular-nums">
                  MD{m.matchday}
                  {m.minute > 0 && m.minute < FULL_TIME ? ` · ${m.minute}'` : ''}
                </span>
              </>
            );
            const key = `${m.matchday}-${m.kind}-${m.teamId}-${m.minute}-${m.playerRef ?? ''}`;
            return (
              <li key={key}>
                {m.fixtureId !== null ? (
                  <button type="button" onClick={() => onOpen(m.fixtureId!)} className="flex w-full items-start gap-2 rounded-lg px-1 py-1.5 text-left text-sm hover:bg-white/5">
                    {body}
                  </button>
                ) : (
                  <div className="flex items-start gap-2 px-1 py-1.5 text-sm">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
