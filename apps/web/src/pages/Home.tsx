import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { joinCodeSchema, type PublicLobby } from '@deadline-day/protocol';
import { errorMessage, get, post } from '../lib/api';
import { useMe } from '../lib/auth';
import { plural } from '../lib/format';
import { Button, Card, CardTitle, ErrorText, Input, LinkButton, Modal, Skeleton } from '../components/ui';
import { SignInGate } from '../components/SignInGate';
import { randomTeamDraft } from '../components/team';

export function HomePage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [needUser, setNeedUser] = useState(false);

  const lobbies = useQuery({
    queryKey: ['public-lobbies'],
    queryFn: async () => (await get<{ lobbies: PublicLobby[] }>('/api/games/public')).lobbies,
    refetchInterval: 10_000,
  });

  const solo = useMutation({
    mutationFn: async () => {
      const team = randomTeamDraft(me?.displayName ?? '');
      return (await post<{ code: string }>('/api/games/solo', { team })).code;
    },
    onSuccess: (c) => void navigate(`/lobby/${c}`),
  });
  const startSolo = solo.mutate;

  // Signed in from the solo prompt: start the solo game straight away.
  useEffect(() => {
    if (needUser && me) {
      setNeedUser(false);
      startSolo();
    }
  }, [needUser, me, startSolo]);

  const join = (e: FormEvent) => {
    e.preventDefault();
    const parsed = joinCodeSchema.safeParse(code);
    if (!parsed.success) {
      setCodeError(parsed.error.issues[0]?.message ?? 'Check the code');
      return;
    }
    void navigate(`/lobby/${parsed.data}`);
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16">
      <section className="relative overflow-hidden py-12 text-center sm:py-20">
        <div className="pitch-stripes absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-pitch-400 sm:text-sm">Live football auction</p>
        <h1 className="mt-3 font-display text-6xl font-bold uppercase leading-none tracking-tight sm:text-8xl">Deadline Day</h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-white/70 sm:text-lg">
          Take a $1,000M budget, bid against your friends for real footballers, build a starting XI and see who wins a
          38-game league against the best clubs in the world.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <CardTitle>Create game</CardTitle>
          <p className="flex-1 text-sm text-white/60">Pick the budget, timers and rules, then invite friends with a code or QR.</p>
          <LinkButton to="/create" size="lg" className="w-full">Create game</LinkButton>
        </Card>

        <Card className="flex flex-col gap-3">
          <CardTitle>Join with code</CardTitle>
          <form onSubmit={join} className="flex flex-1 flex-col gap-3">
            <Input
              aria-label="Game code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setCodeError(null);
              }}
              placeholder="ABC234"
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              className="text-center font-display text-2xl uppercase tracking-[0.4em] sm:text-2xl"
            />
            {codeError && <p className="text-xs text-red-300">{codeError}</p>}
            <Button type="submit" size="lg" variant="secondary" className="mt-auto w-full">
              Join game
            </Button>
          </form>
        </Card>

        <Card className="flex flex-col gap-3">
          <CardTitle>Play solo</CardTitle>
          <p className="flex-1 text-sm text-white/60">One click: you against an Easy, a Medium and a Hard bot. Change your team in the lobby.</p>
          <ErrorText>{solo.error ? errorMessage(solo.error) : null}</ErrorText>
          <Button size="lg" variant="gold" className="w-full" loading={solo.isPending} onClick={() => (me ? solo.mutate() : setNeedUser(true))}>
            Play solo vs bots
          </Button>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle action={<span className="text-xs text-white/50">Updates every 10 s</span>}>Open lobbies</CardTitle>
          {lobbies.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : lobbies.data?.length ? (
            <ul className="flex flex-col gap-2">
              {lobbies.data.map((l) => (
                <li key={l.code}>
                  <Link
                    to={`/lobby/${l.code}`}
                    className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-night-950/50 px-4 py-2 ring-1 ring-white/5 hover:ring-pitch-400/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{l.name}</span>
                      <span className="block text-xs text-white/50">Host {l.hostName}</span>
                    </span>
                    <span className="shrink-0 text-sm text-white/70">
                      {l.teams}/{l.maxTeams} teams
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-night-950/40 px-4 py-6 text-center text-sm text-white/50">
              No public lobbies right now. Create one and set it to public.
            </p>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Hall of Fame</CardTitle>
            <p className="rounded-xl bg-night-950/40 px-4 py-6 text-center text-sm text-white/50">
              No champions yet. Win a season to put your name here.
            </p>
          </Card>
          <Card className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold uppercase tracking-wide">New here?</h2>
              <p className="text-sm text-white/60">The rules in two minutes.</p>
            </div>
            <LinkButton to="/how-to-play" variant="secondary">How to play</LinkButton>
          </Card>
        </div>
      </div>

      <Modal open={needUser && !me} onClose={() => setNeedUser(false)} title="Who's playing?">
        <SignInGate why="Pick a name to start a solo game. You can create an account later to keep your history." />
      </Modal>
      {lobbies.data && <span className="sr-only">{plural(lobbies.data.length, 'open lobby', 'open lobbies')}</span>}
    </main>
  );
}
