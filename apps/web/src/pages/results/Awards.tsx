import type { ReactNode } from 'react';
import { FORMATIONS } from '@deadline-day/engine';
import type { AwardPlayerView, BuyAwardView, ResultsView } from '@deadline-day/protocol';
import { Card, CardTitle, cx } from '../../components/ui';
import { inkOn, money } from '../../lib/format';
import { surname } from '../../lib/auction';
import type { SeasonIndex } from '../../lib/season';
import { TeamName, Trophy } from '../season/parts';

function AwardCard({ label, icon, children, highlight = false }: { label: string; icon: ReactNode; children: ReactNode; highlight?: boolean }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5 rounded-2xl p-3 ring-1', highlight ? 'bg-gold-400/10 ring-gold-400/30' : 'bg-night-950/50 ring-white/5')}>
      <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-gold-400">
        {icon}
        {label}
      </p>
      {children}
    </div>
  );
}

function PlayerAward({ index, award, value }: { index: SeasonIndex; award: AwardPlayerView | null; value: (a: AwardPlayerView) => string }) {
  if (!award) return <p className="text-sm text-white/50">Nobody this season</p>;
  return (
    <>
      <p className="truncate font-display text-xl font-semibold uppercase leading-tight">{award.name}</p>
      <TeamName team={index.teams.get(award.teamId)} className="text-xs text-white/70" />
      <p className="text-sm font-semibold tabular-nums">{value(award)}</p>
    </>
  );
}

function BuyAward({ index, award }: { index: SeasonIndex; award: BuyAwardView | null }) {
  if (!award) return <p className="text-sm text-white/50">No auction buys played this season</p>;
  return (
    <>
      <p className="truncate font-display text-xl font-semibold uppercase leading-tight">{award.name}</p>
      <TeamName team={index.teams.get(award.teamId)} className="text-xs text-white/70" />
      <p className="text-sm tabular-nums">
        <span className="font-semibold">{money(award.priceM)}</span>
        <span className="text-white/60">
          {' '}
          · rated {award.value.toFixed(2)}, price implied {award.impliedRating.toFixed(2)}
        </span>
      </p>
    </>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);
const BALL = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3 3 2.2-1.1 3.5h-3.8L9 7.2 12 5Z';
const STAR = 'm12 2 2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7L12 2Z';
const GLOVE = 'M7 4a1.5 1.5 0 0 1 3 0v6h1V3a1.5 1.5 0 0 1 3 0v7h1V5a1.5 1.5 0 0 1 3 0v9a7 7 0 0 1-7 7h-1a6 6 0 0 1-5.6-3.9L3.6 12a1.5 1.5 0 0 1 2.7-1.2L7 12V4Z';
const TAG = 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Zm4-5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z';

/** Champion plus the seven player awards. */
export function AwardsGrid({ index, results }: { index: SeasonIndex; results: ResultsView }) {
  const a = results.awards;
  const champ = index.teams.get(a.championId);
  const champRow = index.view.standings.at(-1)?.find((r) => r.teamId === a.championId);
  return (
    <Card>
      <CardTitle>Awards</CardTitle>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:grid-cols-3">
        <AwardCard label="Champion" icon={<Trophy className="size-3.5" />} highlight>
          <TeamName team={champ} size="md" className="font-display text-lg uppercase" />
          <p className="text-sm font-semibold tabular-nums">
            {champRow?.points ?? 0} points · {champRow?.won ?? 0} wins
          </p>
        </AwardCard>
        <AwardCard label="Golden Boot" icon={<Icon d={BALL} />}>
          <PlayerAward index={index} award={a.goldenBoot} value={(x) => `${x.value} goals`} />
        </AwardCard>
        <AwardCard label="Playmaker" icon={<Icon d={BALL} />}>
          <PlayerAward index={index} award={a.playmaker} value={(x) => `${x.value} assists`} />
        </AwardCard>
        <AwardCard label="Golden Glove" icon={<Icon d={GLOVE} />}>
          <PlayerAward index={index} award={a.goldenGlove} value={(x) => `${x.value} clean sheets`} />
        </AwardCard>
        <AwardCard label="Player of the Season" icon={<Icon d={STAR} />}>
          <PlayerAward index={index} award={a.playerOfTheSeason} value={(x) => `${x.value.toFixed(2)} average rating`} />
        </AwardCard>
        <AwardCard label="Best Buy" icon={<Icon d={TAG} />}>
          <BuyAward index={index} award={a.bestBuy} />
        </AwardCard>
        <AwardCard label="Biggest Overpay" icon={<Icon d={TAG} />}>
          <BuyAward index={index} award={a.biggestOverpay} />
        </AwardCard>
      </div>
      <p className="mt-3 text-xs text-white/45">
        Best Buy and Biggest Overpay compare a bought player's average rating with the rating his price implied. Player of the Season needs at least half the most appearances.
      </p>
    </Card>
  );
}

/** Best XI of the season by average rating, on a pitch. */
export function TeamOfTheSeason({ index, results }: { index: SeasonIndex; results: ResultsView }) {
  const tots = results.awards.teamOfTheSeason;
  const coords = new Map(FORMATIONS[tots.formation].slots.map((s) => [s.key, s]));
  return (
    <Card>
      <CardTitle action={<span className="text-xs text-white/50">{tots.formation}</span>}>Team of the Season</CardTitle>
      {tots.slots.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/50">Not enough regular players to pick a team.</p>
      ) : (
        <>
          <div className="pitch-stripes relative aspect-[4/5] w-full overflow-hidden rounded-2xl ring-1 ring-white/10 sm:aspect-[5/4] lg:aspect-[4/3]">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/15" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
            {tots.slots.map((s) => {
              const c = coords.get(s.slotKey);
              const team = index.teams.get(s.teamId);
              if (!c || !team) return null;
              return (
                <div
                  key={s.slotKey}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
                  style={{ left: `${4 + c.x * 0.92}%`, top: `${5 + c.y * 0.88}%` }}
                  aria-label={`${s.slotKey}: ${s.name} of ${team.name}, ${s.avgRating.toFixed(2)} average`}
                >
                  <span
                    className="grid size-9 place-items-center rounded-full font-display text-sm font-bold shadow-lg ring-2 ring-night-950 sm:size-10"
                    style={{ background: team.color, color: inkOn(team.color) }}
                  >
                    {s.avgRating.toFixed(1)}
                  </span>
                  <span className="max-w-[4.75rem] truncate rounded bg-night-950/75 px-1 text-center text-[0.65rem] font-semibold leading-tight">
                    {surname(s.name)}
                    <span className="block truncate font-normal text-white/60">{team.monogram}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-white/45">Circle: season average rating, in the team's colour. Under the name: the team's badge letters.</p>
        </>
      )}
    </Card>
  );
}
