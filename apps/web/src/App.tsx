import { Component, useEffect, type ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { Header } from './components/Header';
import { Toaster } from './components/Toaster';
import { LinkButton } from './components/ui';
import { AuctionPage } from './pages/Auction';
import { CreatePage } from './pages/Create';
import { HomePage } from './pages/Home';
import { HowToPlayPage } from './pages/HowToPlay';
import { LobbyPage } from './pages/Lobby';
import { LoginPage } from './pages/Login';

/** New page, new scroll: start every route at the top. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Last line of defence: a crash shows a way back instead of a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-display text-4xl font-bold uppercase">Something went wrong</h1>
        <p className="mt-3 text-white/60">Reload the page. Your game is saved on the server.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-6 min-h-11 rounded-xl bg-pitch-500 px-5 font-semibold text-night-950">
          Reload
        </button>
      </main>
    );
  }
}

function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="font-display text-5xl font-bold uppercase">Offside</h1>
      <p className="mt-3 text-white/60">That page does not exist.</p>
      <LinkButton to="/" className="mt-6">Back home</LinkButton>
    </main>
  );
}

export function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollToTop />
      <Header />
      <div className="flex flex-1 flex-col">
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/how-to-play" element={<HowToPlayPage />} />
          <Route path="/lobby/:code" element={<LobbyPage />} />
          <Route path="/auction/:code" element={<AuctionPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ErrorBoundary>
      </div>
      <footer className="border-t border-white/10 px-4 py-6 text-center text-xs text-white/50">
        Deadline Day is an unofficial fan game. It is not affiliated with, endorsed by or connected to any club, league or player.
      </footer>
      <Toaster />
    </div>
  );
}
