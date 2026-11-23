import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AuctionView, GameSnapshot, RevealTeam, RevealView, UserView } from '@deadline-day/protocol';
import { useMe } from '../lib/auth';
import { get, post } from '../lib/api';
import { money } from '../lib/format';
import { seconds } from '../lib/auction';
import { useGame } from '../hooks/useGame';
import { useAction } from '../hooks/useAction';
import { useServerNow } from '../hooks/useClock';
import { Button, Card, CardTitle, cx, LinkButton, Pill, Skeleton } from '../components/ui';
import { TeamBadge } from '../components/team';
import { PitchView } from './auction/TeamPitch';
import { TierBadge } from './auction/parts';

export function RevealPage() {
  const params = useParams();
  const { code, snapshot: snap, error } = useGame(params.code ?? '');
  const { data: me } = useMe();
  const navigate = useNavigate();
  const phase = snap?.auction?.phase;

  useEffect(() => {
    if (snap?.game.status === 'lobby') void navigate(`/lobby/${code}`, { replace: true });
    else if (phase && phase !== 'complete') void navigate(`/auction/${code}`, { replace: true });
  }, [snap?.game.status, phase, code, navigate]);

  // Watching the reveal when the season starts: go straight to it. Opened later, the page offers a link.
  const sawPreseason = useRef(false);
  const hasSeason = !!snap?.season;
  useEffect(() => {
    if (!snap) return;
    if (!hasSeason) sawPreseason.current = true;
    else if (sawPreseason.current) void navigate(`/season/${code}`);
  }, [snap, hasSeason, code, navigate]);

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
  if (!snap?.auction || phase !== 'complete') {
    return (
      <main className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </main>
    );
  }
  return <Reveal snap={snap} auction={snap.auction} me={me} />;
}

function Reveal({ snap, auction, me }: { snap: GameSnapshot; auction: AuctionView; me: UserView | null | undefined }) {
  const code = snap.game.code;
  const base = `/api/games/${code}`;
  const now = useServerNow(250);
  const query = useQuery({
    queryKey: ['reveal', code, auction.revealStartedAt, auction.sales.length],
    queryFn: () => get<{ reveal: RevealView }>(`${base}/reveal`).then((r) => r.reveal),
  });
  const [manual, setManual] = useState<number | null>(null);
  const reveal = query.data;
  if (!reveal) {
    return (
      <main className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </main>
    );
  }

  const last = reveal.teams.length; // the final step: unsold players and the league preview
  const auto = Math.min(last, Math.max(0, Math.floor((now - reveal.revealStartedAt) / reveal.stepMs)));
  const step = manual ?? auto;
  const go = (n: number) => setManual(Math.max(0, Math.min(last, n)));
  const team = step < last ? reveal.teams[step] : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-4 sm:px-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-pitch-400">Auction complete</p>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">Team Reveal</h1>
          <p className="truncate text-sm text-white/60">{snap.game.name}</p>
        </div>
        <SeasonCountdown snap={snap} auction={auction} me={me} now={now} />
      </header>

      <nav className="mb-4 flex items-center gap-2" aria-label="Reveal steps">
        <Button variant="secondary" size="sm" onClick={() => go(step - 1)} disabled={step === 0} aria-label="Previous team">
          ‹
        </Button>
        <ol className="flex flex-1 flex-wrap items-center justify-center gap-1.5">
          {reveal.teams.map((t, i) => (
            <li key={t.participantId}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-label={`Show ${t.teamName}`}
                aria-current={i === step ? 'step' : undefined}
                className={cx('block size-3 rounded-full transition', i === step ? 'scale-125' : 'opacity-50 hover:opacity-90')}
                style={{ backgroundColor: t.color }}
              />
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => go(last)}
              aria-current={step === last ? 'step' : undefined}
              className={cx('rounded-full px-2 text-xs font-semibold transition', step === last ? 'bg-gold-400 text-ink' : 'bg-white/10 text-white/70')}
            >
              League
            </button>
          </li>
        </ol>
        <Button variant="secondary" size="sm" onClick={() => go(step + 1)} disabled={step === last} aria-label="Next team">
          ›
        </Button>
      </nav>

      {team ? (
        <TeamReveal key={team.participantId} team={team} auction={auction} total={reveal.teams.length} index={step} mine={team.participantId === snap.participants.find((p) => p.userId === me?.id)?.id} />
      ) : (
        <LeagueReveal reveal={reveal} />
      )}
    </main>
  );
}

function TeamReveal({ team, auction, total, index, mine }: { team: RevealTeam; auction: AuctionView; total: number; index: number; mine: boolean }) {
  const playersById = useMemo(() => new Map(auction.players.map((p) => [p.id, p])), [auction.players]);
  const slots = auction.teams.find((t) => t.participantId === team.participantId)?.slots ?? [];
  return (
    <div className="grid gap-4 motion-safe:animate-[rise_0.4s_ease-out] lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <div className="flex items-center gap-3">
          <TeamBadge color={team.color} monogram={team.monogram} size="lg" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-white/50">
              {index + 1} of {total} · {team.formation}
            </p>
            <h2 className="truncate font-display text-3xl font-bold uppercase">{team.teamName}</h2>
            <p className="truncate text-sm text-white/60">
              {team.managerName} {mine && <span className="text-pitch-400">(you)</span>}
            </p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="League rank" value={`#${team.rank}`} />
          <Stat label="Strength" value={team.strength.toFixed(1)} />
          <Stat label="Grade" value={team.grade} highlight />
          <Stat label="Attack" value={team.attack.toFixed(1)} />
          <Stat label="Defense" value={team.defense.toFixed(1)} />
          <Stat label="Score" value={String(team.gradeScore)} />
          <Stat label="Spent" value={money(team.spentM)} />
          <Stat label="Money left" value={money(team.leftM)} />
          <Stat label="Players" value="11" />
        </dl>
        <p className="mt-2 text-xs text-white/45">Grade preview from pre-season strength and value for money. The final grade also counts where the team finishes.</p>
        <div className="mt-4">
          <PitchView formation={team.formation} slots={slots} playersById={playersById} />
        </div>
      </Card>
      <Card className="lg:col-span-3">
        <CardTitle>Starting XI</CardTitle>
        <ul className="flex flex-col divide-y divide-white/5">
          {team.slots.map((s) => (
            <li key={s.key} className="flex items-center gap-3 py-2">
              <span className="w-10 shrink-0 font-display text-sm text-white/50">{s.key}</span>
              <TierBadge overall={s.overall} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{s.name}</p>
                <p className="flex flex-wrap gap-1.5 text-xs text-white/50">
                  {s.position}
                  {s.outOfPosition && <span className="text-sky-400">playing {s.type}</span>}
                  {s.autoFilled && <Pill>Auto-filled</Pill>}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-gold tabular-nums">{money(s.priceM)}</p>
                <p className="text-[0.7rem] text-white/40">value {money(s.marketValueM)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function LeagueReveal({ reveal }: { reveal: RevealView }) {
  return (
    <div className="grid items-start gap-4 motion-safe:animate-[rise_0.4s_ease-out] lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardTitle action={<Pill>{reveal.league.length} teams</Pill>}>League preview</CardTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-white/45">
              <th className="w-8 py-1 font-medium">#</th>
              <th className="py-1 font-medium">Team</th>
              <th className="hidden py-1 text-right font-medium sm:table-cell">Att</th>
              <th className="hidden py-1 text-right font-medium sm:table-cell">Def</th>
              <th className="py-1 text-right font-medium">Strength</th>
            </tr>
          </thead>
          <tbody>
            {reveal.league.map((r) => (
              <tr key={r.id} className={cx('border-t border-white/5', r.kind !== 'ai' && 'bg-pitch-500/10')}>
                <td className="py-2 font-display text-white/60">{r.rank}</td>
                <td className="py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <TeamBadge color={r.color} monogram={r.monogram} size="sm" />
                    <span className="truncate font-semibold">{r.name}</span>
                    {r.kind !== 'ai' && <Pill tone="green">Auction</Pill>}
                  </span>
                </td>
                <td className="hidden py-2 text-right tabular-nums text-white/70 sm:table-cell">{r.attack.toFixed(1)}</td>
                <td className="hidden py-2 text-right tabular-nums text-white/70 sm:table-cell">{r.defense.toFixed(1)}</td>
                <td className="py-2 text-right font-display tabular-nums">{r.strength.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="lg:col-span-2">
        <CardTitle action={<Pill>{reveal.unsold.length}</Pill>}>Unsold players</CardTitle>
        {reveal.unsold.length === 0 && <p className="text-sm text-white/45">Every player was sold.</p>}
        <ul className="flex max-h-[32rem] flex-col divide-y divide-white/5 overflow-y-auto">
          {reveal.unsold.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <TierBadge overall={p.overall} size="sm" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="text-xs text-white/50">{p.position}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function SeasonCountdown({ snap, auction, me, now }: { snap: GameSnapshot; auction: AuctionView; me: UserView | null | undefined; now: number }) {
  const { run, pending } = useAction();
  const base = `/api/games/${snap.game.code}`;
  const canHost = !!me && (snap.game.hostUserId === me.id || me.role === 'admin');
  const held = auction.paused?.timer === 'countdown';
  const deadline = auction.countdownDeadline;
  const remaining = deadline ? deadline - now : null;
  // The countdown only shows for its last 10 seconds; before that the reveal plays.
  if (snap.season) {
    return (
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <LinkButton to={`/league/${snap.game.code}`} variant="secondary" size="sm">
          League Teams
        </LinkButton>
        <LinkButton to={`/season/${snap.game.code}`} variant="gold" size="sm">
          Go to the season
        </LinkButton>
      </div>
    );
  }
  const label = held
    ? `Season countdown held by ${auction.paused!.byName}`
    : remaining !== null
      ? remaining > 10_000
        ? 'Season starts after the reveal'
        : `Season starts in ${seconds(remaining)}`
      : 'Waiting for the host to start the season';
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <p className={cx('rounded-xl px-3 py-1 text-sm font-semibold', remaining !== null && remaining <= 10_000 && !held ? 'bg-gold-400 text-ink' : 'bg-white/10 text-white/80')} role="timer">
        {label}
      </p>
      {canHost && (
        <div className="flex gap-2">
          {held ? (
            <Button size="sm" onClick={() => void run('resume', () => post(`${base}/auction/resume`))} loading={pending === 'resume'}>
              Resume countdown
            </Button>
          ) : (
            deadline && (
              <Button size="sm" variant="secondary" onClick={() => void run('pause', () => post(`${base}/auction/pause`))} loading={pending === 'pause'}>
                Hold
              </Button>
            )
          )}
          {!held && (
            <Button size="sm" variant="gold" onClick={() => void run('season', () => post(`${base}/season/start`))} loading={pending === 'season'}>
              Start season
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cx('rounded-xl px-2 py-2 ring-1', highlight ? 'bg-gold-400/15 ring-gold-400/30' : 'bg-night-950/50 ring-white/5')}>
      <dt className="text-[0.65rem] uppercase tracking-wide text-white/50">{label}</dt>
      <dd className={cx('font-display text-lg font-semibold tabular-nums', highlight && 'text-gold')}>{value}</dd>
    </div>
  );
}
