import { Component, lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { Header } from './components/Header';
import { Toaster } from './components/Toaster';
import { FirstVisitWalkthrough } from './components/Walkthrough';
import { LinkButton, Skeleton } from './components/ui';
import { AuctionPage } from './pages/Auction';
import { CreatePage } from './pages/Create';
import { HallOfFamePage } from './pages/HallOfFame';
import { HomePage } from './pages/Home';
import { HowToPlayPage } from './pages/HowToPlay';
import { LeaguePage, TeamPage } from './pages/League';
import { LeaderboardPage } from './pages/Leaderboard';
import { LobbyPage } from './pages/Lobby';
import { LoginPage } from './pages/Login';
import { MyProfilePage, UserProfilePage } from './pages/Profile';
import { ResultsPage } from './pages/Results';
import { RevealPage } from './pages/Reveal';
import { SeasonPage } from './pages/Season';

/** The admin panel is its own chunk, so players never download it. */
function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  const Lazy = lazy(async () => ({ default: (await load())[name] as ComponentType }));
  return function Loaded() {
    return (
      <Suspense fallback={<Skeleton className="mx-auto mt-6 h-96 w-full max-w-7xl" />}>
        <Lazy />
      </Suspense>
    );
  };
}
const admin = () => import('./pages/admin');
const AdminLayout = lazyNamed(admin, 'AdminLayout');
const OverviewTab = lazyNamed(admin, 'OverviewTab');
const PoolTab = lazyNamed(admin, 'PoolTab');
const ClubsTab = lazyNamed(admin, 'ClubsTab');
const GamesTab = lazyNamed(admin, 'GamesTab');
const GameDetailPage = lazyNamed(admin, 'GameDetailPage');
const SettingsTab = lazyNamed(admin, 'SettingsTab');
const LabTab = lazyNamed(admin, 'LabTab');
const UsersTab = lazyNamed(admin, 'UsersTab');
const AuditTab = lazyNamed(admin, 'AuditTab');
const AnnouncementsTab = lazyNamed(admin, 'AnnouncementsTab');

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
        <button type="button" onClick={() => window.location.reload()} className="mt-6 min-h-11 rounded-xl bg-pitch-500 px-5 font-semibold text-ink">
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
          <Route path="/reveal/:code" element={<RevealPage />} />
          <Route path="/season/:code" element={<SeasonPage />} />
          <Route path="/league/:code" element={<LeaguePage />} />
          <Route path="/team/:code/:teamId" element={<TeamPage />} />
          <Route path="/results/:code" element={<ResultsPage />} />
          <Route path="/profile" element={<MyProfilePage />} />
          <Route path="/profile/:username" element={<UserProfilePage />} />
          <Route path="/hall-of-fame" element={<HallOfFamePage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<OverviewTab />} />
            <Route path="pool" element={<PoolTab />} />
            <Route path="clubs" element={<ClubsTab />} />
            <Route path="games" element={<GamesTab />} />
            <Route path="games/:code" element={<GameDetailPage />} />
            <Route path="settings" element={<SettingsTab />} />
            <Route path="lab" element={<LabTab />} />
            <Route path="users" element={<UsersTab />} />
            <Route path="audit" element={<AuditTab />} />
            <Route path="announcements" element={<AnnouncementsTab />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ErrorBoundary>
      </div>
      <footer className="border-t border-white/10 px-4 py-6 text-center text-xs text-white/50">
        Deadline Day is an unofficial fan game. It is not affiliated with, endorsed by or connected to any club, league or player.
      </footer>
      <Toaster />
      <FirstVisitWalkthrough />
    </div>
  );
}
