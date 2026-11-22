import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMe } from '../lib/auth';
import { money } from '../lib/format';
import { useGame } from '../hooks/useGame';
import { Card, CardTitle, LinkButton, Pill, Skeleton } from '../components/ui';
import { ConnectionDot } from '../components/Header';
import { FormationPitch, TeamBadge } from '../components/team';
import { AiClubsCard, PoolPreviewCard } from './lobby/sections';

/** Kickoff screen shown when the auction starts: pool, AI clubs and teams. The live room arrives in M3. */
export function AuctionPage() {
  const params = useParams();
  const { code, snapshot: snap, error } = useGame(params.code ?? '');
  const { data: me } = useMe();
  const navigate = useNavigate();

  useEffect(() => {
    if (snap?.game.status === 'lobby') void navigate(`/lobby/${code}`, { replace: true });
  }, [snap?.game.status, code, navigate]);

  if (error) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-4xl font-bold uppercase">Game not found</h1>
        <LinkButton to="/" className="mt-6">Back home</LinkButton>
      </main>
    );
  }
  if (!snap) {
    return (
      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6 lg:grid-cols-2">
        <Skeleton className="h-40 lg:col-span-2" />
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </main>
    );
  }

  const byId = new Map(snap.participants.map((p) => [p.id, p]));
  const order = snap.game.nominationOrder.map((id) => byId.get(id)).filter((p) => p !== undefined);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4">
      <section className="pitch-stripes relative mb-4 overflow-hidden rounded-3xl px-5 py-8 text-center ring-1 ring-white/10 sm:py-12">
        <p className="flex items-center justify-center gap-3 text-xs uppercase tracking-[0.3em] text-pitch-400">
          Kickoff <ConnectionDot />
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">{snap.game.name}</h1>
        <div className="mx-auto mt-6 grid max-w-xl grid-cols-3 gap-2">
          <Stat label="Players in pool" value={String(snap.pool.totalSize)} />
          <Stat label="Will go unsold" value={String(snap.pool.unsold)} />
          <Stat label="AI clubs" value={String(snap.aiClubs.count)} />
        </div>
        <p className="mx-auto mt-6 max-w-lg text-sm text-white/70">
          The order and formations are locked. The live auction room, where you nominate and bid, is the next part being built.
        </p>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle action={<Pill tone="gold">{money(snap.game.settings.budgetM)} each</Pill>}>Teams in nomination order</CardTitle>
          <ol className="flex flex-col gap-2">
            {order.map((p, i) => (
              <li key={p.id} className="flex min-h-14 items-center gap-3 rounded-xl bg-night-950/50 px-3 py-2">
                <span className="w-5 text-center font-display text-lg text-white/50">{i + 1}</span>
                <TeamBadge color={p.color} monogram={p.monogram} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {p.teamName} {p.userId === me?.id && <span className="text-xs text-pitch-400">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-white/55">{p.managerName}</p>
                </div>
                <FormationPitch formation={p.formation} color={p.color} className="h-12 w-auto" />
                <span className="w-14 text-right font-display text-sm">{p.formation}</span>
              </li>
            ))}
          </ol>
        </Card>
        <div className="flex flex-col gap-4">
          <PoolPreviewCard pool={snap.pool} live={false} />
          <AiClubsCard ai={snap.aiClubs} />
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-night-950/60 px-2 py-3 ring-1 ring-white/10">
      <p className="font-display text-3xl font-bold text-gold-400 sm:text-4xl">{value}</p>
      <p className="text-[0.7rem] uppercase tracking-wide text-white/60 sm:text-xs">{label}</p>
    </div>
  );
}
