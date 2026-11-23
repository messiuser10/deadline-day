import type { AuctionGradeView, HeadToHeadView, ResultsView } from '@deadline-day/protocol';
import { Card, CardTitle, cx, Pill } from '../../components/ui';
import { money } from '../../lib/format';
import { GRADE_TEXT, gradeTone, pctOf, TAG_LABEL, TAG_TONE } from '../../lib/results';
import { ordinal, type SeasonIndex } from '../../lib/season';
import { TeamName } from '../season/parts';

/** One auction team's grade, money and every purchase with its Steal / Fair / Overpay tag. */
function GradeCard({ index, g, mine }: { index: SeasonIndex; g: AuctionGradeView; mine: boolean }) {
  const team = index.teams.get(g.teamId);
  const tone = gradeTone(g.grade);
  const counts = { steal: 0, fair: 0, overpay: 0 };
  for (const p of g.purchases) counts[p.tag]++;
  return (
    <article className={cx('rounded-2xl p-3 ring-1', mine ? 'bg-gold-400/[0.07] ring-gold-400/30' : 'bg-night-950/50 ring-white/5')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <TeamName team={team} size="md" tag={false} className="font-display text-lg uppercase" />
          <p className="mt-0.5 truncate text-xs text-white/55">
            {team?.managerName ?? 'Bot'} · pre-season #{g.preRank} · finished {ordinal(g.finalPosition)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cx('font-display text-4xl font-bold leading-none', GRADE_TEXT[tone])} aria-label={`Grade ${g.grade}`}>
            {g.grade}
          </p>
          <p className="text-[0.65rem] uppercase tracking-wide text-white/50">{g.score.toFixed(1)} / 100</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-1.5 text-center text-xs">
        <div className="rounded-lg bg-white/5 px-1 py-1.5">
          <dt className="text-white/50">Strength</dt>
          <dd className="font-semibold tabular-nums">{pctOf(g.strengthScore)}</dd>
        </div>
        <div className="rounded-lg bg-white/5 px-1 py-1.5">
          <dt className="text-white/50">Finish</dt>
          <dd className="font-semibold tabular-nums">{pctOf(g.finishScore)}</dd>
        </div>
        <div className="rounded-lg bg-white/5 px-1 py-1.5">
          <dt className="text-white/50">Value</dt>
          <dd className="font-semibold tabular-nums">{pctOf(g.valueScore)}</dd>
        </div>
      </dl>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        <div>
          <dt className="text-xs text-white/50">Spent</dt>
          <dd className="font-semibold tabular-nums">{money(g.spentM)}</dd>
        </div>
        <div>
          <dt className="text-xs text-white/50">Money left</dt>
          <dd className="font-semibold tabular-nums">{money(g.leftM)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-white/50">Most expensive</dt>
          <dd className="truncate">{g.mostExpensive ? `${g.mostExpensive.name}, ${money(g.mostExpensive.priceM)}` : '-'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-white/50">Best bargain</dt>
          <dd className="truncate">{g.bestBargain ? `${g.bestBargain.name}, ${money(g.bestBargain.priceM)} (value ${money(g.bestBargain.marketValueM)})` : '-'}</dd>
        </div>
      </dl>

      <details className="group mt-3">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-xl bg-white/5 px-3 text-sm font-medium hover:bg-white/10">
          <span>
            {g.purchases.length} signings: {counts.steal} steal{counts.steal === 1 ? '' : 's'}, {counts.fair} fair, {counts.overpay} overpay{counts.overpay === 1 ? '' : 's'}
          </span>
          <span className="text-white/50 transition group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </summary>
        <ul className="mt-1 divide-y divide-white/5">
          {g.purchases.map((p) => (
            <li key={p.ref} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="w-8 shrink-0 text-center font-display font-semibold">{p.overall}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className="block text-xs text-white/50">
                  {p.position}
                  {p.autoFilled && ' · auto-filled at base price'}
                </span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block font-semibold">{money(p.priceM)}</span>
                <span className="block text-xs text-white/50">value {money(p.marketValueM)}</span>
              </span>
              <span className="w-16 shrink-0 text-right">
                <Pill tone={TAG_TONE[p.tag]}>{TAG_LABEL[p.tag]}</Pill>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export function AuctionGrades({ index, results, myTeamId }: { index: SeasonIndex; results: ResultsView; myTeamId: string | null }) {
  return (
    <Card>
      <CardTitle>Auction grades</CardTitle>
      <p className="-mt-1 mb-3 text-sm text-white/55">
        Each grade mixes pre-season strength rank (35%), final position (45%) and how much market value the budget bought (20%). A Steal cost at most 80% of market value; an Overpay at least 130%.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {results.grades.map((g) => (
          <GradeCard key={g.teamId} index={index} g={g} mine={g.teamId === myTeamId} />
        ))}
      </div>
    </Card>
  );
}

function Leg({ index, leg }: { index: SeasonIndex; leg: HeadToHeadView['legs'][number] }) {
  const home = index.teams.get(leg.homeId);
  const away = index.teams.get(leg.awayId);
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="w-12 shrink-0 text-xs text-white/45">MD {leg.matchday}</span>
      <span className="min-w-0 flex-1 truncate text-right">{home?.name}</span>
      <span className="shrink-0 rounded bg-white/10 px-1.5 font-display font-semibold tabular-nums">
        {leg.homeGoals}-{leg.awayGoals}
      </span>
      <span className="min-w-0 flex-1 truncate">{away?.name}</span>
    </li>
  );
}

/** Every pair of auction teams: both meetings this season and the record across all seasons of the game. */
export function HeadToHead({ index, results }: { index: SeasonIndex; results: ResultsView }) {
  if (!results.headToHead.length) return null;
  return (
    <Card>
      <CardTitle>Head to head</CardTitle>
      <ul className="flex flex-col gap-3">
        {results.headToHead.map((h) => {
          const a = index.teams.get(h.aId);
          const b = index.teams.get(h.bId);
          const r = h.allTime;
          return (
            <li key={`${h.aId}-${h.bId}`} className="rounded-2xl bg-night-950/50 p-3 ring-1 ring-white/5">
              <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <TeamName team={a} tag={false} className="min-w-0" />
                <span className="shrink-0 text-white/40">v</span>
                <TeamName team={b} tag={false} className="min-w-0" />
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {h.legs.map((l) => (
                  <Leg key={l.fixtureId} index={index} leg={l} />
                ))}
              </ul>
              {r.seasons > 1 && (
                <p className="mt-2 text-xs text-white/60">
                  All {r.seasons} seasons: {a?.name} {r.aWins} wins, {r.draws} draws, {b?.name} {r.bWins} wins · goals {r.aGoals}-{r.bGoals}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
