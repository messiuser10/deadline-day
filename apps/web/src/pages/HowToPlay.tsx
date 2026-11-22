import { Card, LinkButton } from '../components/ui';

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Pick a formation',
    body: 'Create or join a game, name your team and choose one of ten formations. The auction pool is sized from everyone’s formations, plus a few spare players per position.',
  },
  {
    title: 'Nominate and bid',
    body: 'Teams take turns putting a player up for auction. Everyone who has an open slot he can play bids until the clock runs out. A late bid resets the clock, so no sniping.',
  },
  {
    title: 'Mind the budget',
    body: 'Every team starts with the same budget and must always keep enough to fill its remaining slots at the cheapest base price. The server stops any bid that would strand you.',
  },
  {
    title: 'Fill your XI',
    body: 'The auction ends when every team has 11 players. Bought a winger who can play striker? He can fill either slot.',
  },
  {
    title: 'Play the season',
    body: 'Your team joins the strongest real clubs to make a 20-team league. Buying a club’s star weakens that club. 38 matchdays are simulated, then the awards and grades come out.',
  },
];

export function HowToPlayPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8">
      <h1 className="font-display text-5xl font-bold uppercase tracking-tight">How to play</h1>
      <p className="mt-3 text-white/70">A game takes 20 to 40 minutes with friends, or a few minutes against bots.</p>
      <ol className="mt-6 flex flex-col gap-3">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <Card className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-pitch-500 font-display text-xl font-bold text-night-950">{i + 1}</span>
              <div>
                <h2 className="font-display text-xl font-semibold uppercase tracking-wide">{s.title}</h2>
                <p className="mt-1 text-sm text-white/70">{s.body}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <LinkButton to="/create" size="lg" className="flex-1">Create a game</LinkButton>
        <LinkButton to="/" size="lg" variant="secondary" className="flex-1">Back home</LinkButton>
      </div>
    </main>
  );
}
