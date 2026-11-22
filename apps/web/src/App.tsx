import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router';

interface Health {
  status: string;
  poolPlayers: number;
  seeded: boolean;
}

function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject(new Error(String(r.status)))))
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-pitch-400">Live football auction</p>
      <h1 className="font-display text-6xl font-bold uppercase tracking-tight sm:text-7xl">Deadline Day</h1>
      <p className="max-w-xl text-lg text-white/70">
        Grab a $1 billion budget, bid against your friends for real footballers, build a starting XI and see who wins
        the league.
      </p>
      <p className="text-sm text-white/50" role="status">
        {error
          ? 'Server not reachable yet.'
          : health
            ? health.seeded
              ? `${health.poolPlayers} players ready for auction.`
              : 'Server is up. Run npm run seed to load the players.'
            : 'Checking server...'}
      </p>
    </main>
  );
}

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Routes>
        <Route path="*" element={<Home />} />
      </Routes>
      <footer className="border-t border-white/10 px-4 py-6 text-center text-xs text-white/50">
        Deadline Day is an unofficial fan game. It is not affiliated with, endorsed by or connected to any club, league
        or player.
      </footer>
    </div>
  );
}
