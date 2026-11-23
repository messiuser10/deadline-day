import { useState } from 'react';
import { Button, Card, LinkButton } from '../components/ui';
import { Walkthrough } from '../components/Walkthrough';
import { HOW_TO_PLAY } from '../lib/howToPlay';

const TIPS = [
  'On a phone, the clock and the bid buttons sit at the bottom of the screen. On your turn, Choose a player opens the pool.',
  'On a keyboard, press / to search the pool, the arrow keys to move through it, Enter to nominate and W to star a player.',
  'Star players to get an alert when they come up. A bid that loses a race tells you the new price.',
  'Short of friends? Add Easy, Medium or Hard bots in the lobby, or press Play solo on the home page.',
  'The header has a light theme and sound effects (a gavel and a whistle). Sound is off until you turn it on.',
];

export function HowToPlayPage() {
  const [tour, setTour] = useState(false);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8">
      <h1 className="font-display text-5xl font-bold uppercase tracking-tight">How to play</h1>
      <p className="mt-3 text-white/70">A game takes 20 to 40 minutes with friends, or a few minutes against bots.</p>
      <Button variant="ghost" size="sm" className="-ml-3 mt-2" onClick={() => setTour(true)}>
        Show the walkthrough
      </Button>
      <ol className="mt-6 flex flex-col gap-3">
        {HOW_TO_PLAY.map((s, i) => (
          <li key={s.title}>
            <Card className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-pitch-500 font-display text-xl font-bold text-ink">{i + 1}</span>
              <div>
                <h2 className="font-display text-xl font-semibold uppercase tracking-wide">{s.title}</h2>
                <p className="mt-1 text-sm text-white/70">{s.body}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      <Card className="mt-6">
        <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Good to know</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-white/70">
          {TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Card>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <LinkButton to="/create" size="lg" className="flex-1">Create a game</LinkButton>
        <LinkButton to="/" size="lg" variant="secondary" className="flex-1">Back home</LinkButton>
      </div>
      <Walkthrough open={tour} onClose={() => setTour(false)} />
    </main>
  );
}
