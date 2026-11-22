import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { GameSettings, LobbyUpdate } from '@deadline-day/protocol';
import { patch, post } from '../lib/api';
import { useMe, usePublicSettings } from '../lib/auth';
import { serverNow } from '../lib/socket';
import { useGame } from '../hooks/useGame';
import { useAction } from '../hooks/useAction';
import { Button, Card, CardTitle, cx, LinkButton, Modal, Skeleton } from '../components/ui';
import { ConnectionDot } from '../components/Header';
import { SettingsForm, SettingsSummary } from '../components/SettingsForm';
import {
  AiClubsCard,
  ChatCard,
  InviteCard,
  JoinCard,
  MyTeamCard,
  NominationOrderCard,
  ParticipantsCard,
  PoolPreviewCard,
  type LobbyCtx,
} from './lobby/sections';

type Tab = 'teams' | 'pool' | 'rules' | 'chat';
const TABS: { id: Tab; label: string }[] = [
  { id: 'teams', label: 'Teams' },
  { id: 'pool', label: 'Pool' },
  { id: 'rules', label: 'Rules' },
  { id: 'chat', label: 'Chat' },
];

export function LobbyPage() {
  const params = useParams();
  const { code, snapshot: snap, error, rewatch } = useGame(params.code ?? '');
  const { data: me } = useMe();
  const { data: settings } = usePublicSettings();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('teams');
  const [seenChat, setSeenChat] = useState(0);

  const status = snap?.game.status;
  useEffect(() => {
    if (status && status !== 'lobby' && status !== 'cancelled') void navigate(`/auction/${code}`, { replace: true });
  }, [status, code, navigate]);

  // Sign-in changes the socket identity: watch again so presence follows the new user.
  const meId = me?.id;
  useEffect(() => {
    if (meId) rewatch();
  }, [meId, rewatch]);

  const chatCount = snap?.chat.length ?? 0;
  useEffect(() => {
    if (tab === 'chat') setSeenChat(chatCount);
  }, [tab, chatCount]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-4xl font-bold uppercase">Game not found</h1>
        <p className="mt-3 text-white/60">{error.code === 'GAME_NOT_FOUND' ? `No game has the code ${code}. Check it with the host.` : error.message}</p>
        <LinkButton to="/" className="mt-6">Back home</LinkButton>
      </main>
    );
  }
  if (!snap || !settings) return <LobbySkeleton />;

  if (snap.game.status === 'cancelled') {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-4xl font-bold uppercase">Game cancelled</h1>
        <p className="mt-3 text-white/60">{snap.game.name} was cancelled by the host.</p>
        <LinkButton to="/" className="mt-6">Back home</LinkButton>
      </main>
    );
  }

  const mine = me ? snap.participants.find((p) => p.userId === me.id) : undefined;
  const canHost = !!me && (snap.game.hostUserId === me.id || me.role === 'admin');
  const ctx: LobbyCtx = { snap, me, mine, canHost, settings, base: `/api/games/${code}` };
  const unread = tab === 'chat' ? 0 : Math.max(0, chatCount - seenChat);
  const show = (t: Tab) => (tab === t ? 'flex' : 'hidden lg:flex');

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-36 pt-4 lg:pb-28">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-pitch-400">
            Lobby <ConnectionDot />
          </p>
          <h1 className="truncate font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">{snap.game.name}</h1>
        </div>
        <p className="font-display text-xl tracking-[0.2em] text-gold-400 lg:hidden">{code}</p>
      </div>

      <div className="sticky top-14 z-20 -mx-4 mb-4 border-b border-white/5 bg-night-900/90 px-4 backdrop-blur lg:hidden" role="tablist" aria-label="Lobby sections">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'relative min-h-12 flex-1 text-sm font-semibold transition',
                tab === t.id ? 'text-white after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-pitch-400' : 'text-white/50',
              )}
            >
              {t.label}
              {t.id === 'chat' && unread > 0 && (
                <span className="ml-1 rounded-full bg-pitch-500 px-1.5 text-[0.65rem] font-bold text-night-950">{unread}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-12">
        <div className={cx('flex-col gap-4 lg:col-span-4', show('teams'))}>
          {mine ? <MyTeamCard ctx={ctx} onLeft={rewatch} /> : <JoinCard ctx={ctx} onJoined={rewatch} />}
          <ParticipantsCard ctx={ctx} />
          <NominationOrderCard ctx={ctx} />
          <div className="lg:hidden">
            <InviteCard code={code} />
          </div>
        </div>
        <div className={cx('flex-col gap-4 lg:col-span-5', show('pool'))}>
          <PoolPreviewCard pool={snap.pool} live />
          <AiClubsCard ai={snap.aiClubs} />
        </div>
        <div className="contents lg:col-span-3 lg:flex lg:flex-col lg:gap-4">
          <div className="hidden lg:block">
            <InviteCard code={code} />
          </div>
          <div className={cx('flex-col gap-4', show('rules'))}>
            <RulesCard ctx={ctx} />
          </div>
          <div className={cx('flex-col', show('chat'))}>
            <ChatCard ctx={ctx} className="w-full" />
          </div>
        </div>
      </div>

      <StartBar ctx={ctx} onJoinClick={() => {
        setTab('teams');
        requestAnimationFrame(() => document.getElementById('join')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }} />
      {snap.game.countdownDeadline && <Countdown deadline={snap.game.countdownDeadline} />}
    </main>
  );
}

function RulesCard({ ctx }: { ctx: LobbyCtx }) {
  const { snap, canHost, settings, base } = ctx;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GameSettings>(snap.game.settings);
  const { run, pending } = useAction();
  const navigate = useNavigate();

  return (
    <Card className="w-full">
      <CardTitle
        action={
          canHost ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDraft(snap.game.settings);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          ) : null
        }
      >
        Rules
      </CardTitle>
      <SettingsSummary s={snap.game.settings} />
      {canHost && (
        <button
          type="button"
          className="mt-4 text-xs text-white/50 underline-offset-2 hover:text-red-300 hover:underline"
          onClick={async () => {
            if (!window.confirm('Cancel this game for everyone?')) return;
            const res = await run('cancel', () => post<{ state: LobbyUpdate }>(`${base}/cancel`));
            if (res) void navigate('/');
          }}
        >
          {pending === 'cancel' ? 'Cancelling…' : 'Cancel game'}
        </button>
      )}
      <Modal open={editing} onClose={() => setEditing(false)} title="Game rules">
        <div className="flex flex-col gap-5">
          <SettingsForm
            value={draft}
            onChange={setDraft}
            limits={settings.gameLimits}
            formationsEnabled={settings.formationsEnabled}
            publicLobbiesEnabled={settings.publicLobbiesEnabled}
            minTeams={snap.participants.length}
          />
          <Button
            size="lg"
            loading={pending === 'settings'}
            onClick={async () => {
              const changed = Object.fromEntries(
                Object.entries(draft).filter(([k, v]) => snap.game.settings[k as keyof GameSettings] !== v),
              );
              const res = await run('settings', () => patch<{ state: LobbyUpdate }>(`${base}/settings`, { settings: changed }), 'Rules updated');
              if (res) setEditing(false);
            }}
          >
            Save rules
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function StartBar({ ctx, onJoinClick }: { ctx: LobbyCtx; onJoinClick: () => void }) {
  const { snap, mine, canHost, base } = ctx;
  const { run, pending } = useAction();
  const blockers = snap.startBlockers;
  const hard = blockers.filter((b) => !b.forceable);
  const onlySoft = blockers.length > 0 && hard.length === 0;
  const counting = snap.game.countdownDeadline !== null;

  let message: string;
  let actions: React.ReactNode;
  if (canHost) {
    message = counting ? 'Starting…' : blockers.length ? blockers[0]!.message : 'Everyone is set. Start when you are ready.';
    actions = (
      <Button
        size="lg"
        variant={onlySoft ? 'secondary' : 'primary'}
        className="w-full sm:w-auto sm:min-w-52"
        disabled={hard.length > 0 || counting}
        loading={pending === 'start'}
        onClick={() => void run('start', () => post<{ state: LobbyUpdate }>(`${base}/start`, { force: onlySoft }))}
      >
        {onlySoft ? 'Force start' : 'Start auction'}
      </Button>
    );
  } else if (mine) {
    message = mine.isReady ? 'Waiting for the host to start.' : 'Set your team, then press Ready.';
    actions = (
      <Button
        size="lg"
        variant={mine.isReady ? 'secondary' : 'primary'}
        className="w-full sm:w-auto sm:min-w-52"
        loading={pending === 'ready'}
        disabled={counting}
        onClick={() => void run('ready', () => patch<{ state: LobbyUpdate }>(`${base}/team`, { isReady: !mine.isReady }))}
      >
        {mine.isReady ? '✓ Ready (tap to undo)' : "I'm ready"}
      </Button>
    );
  } else {
    message = 'You are watching this lobby.';
    actions =
      snap.participants.length < snap.game.settings.maxTeams ? (
        <Button size="lg" className="w-full sm:w-auto sm:min-w-52" onClick={onJoinClick}>
          Join this game
        </Button>
      ) : null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-night-900/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={cx('text-sm', hard.length && canHost ? 'text-gold-400' : 'text-white/70')} role="status">
          {message}
        </p>
        {actions}
      </div>
    </div>
  );
}

function Countdown({ deadline }: { deadline: number }) {
  const [left, setLeft] = useState(() => Math.max(0, deadline - serverNow()));
  const raf = useRef(0);
  useEffect(() => {
    const tick = () => {
      setLeft(Math.max(0, deadline - serverNow()));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [deadline]);
  const secs = Math.ceil(left / 1000);
  const total = 5000;
  const frac = Math.min(1, left / total);
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-night-950/85 backdrop-blur-sm" role="alertdialog" aria-label={`Auction starts in ${secs}`}>
      <div className="flex flex-col items-center gap-4">
        <p className="font-display text-xl uppercase tracking-[0.3em] text-pitch-400">Auction starts in</p>
        <div className="relative size-44">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r={r} fill="none" stroke="#ffffff15" strokeWidth="8" />
            <circle cx="60" cy="60" r={r} fill="none" stroke={secs <= 2 ? '#f87171' : '#3ddc84'} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
          </svg>
          <span key={secs} className="absolute inset-0 grid place-items-center font-display text-7xl font-bold motion-safe:animate-[pop_300ms_ease-out]">
            {secs}
          </span>
        </div>
      </div>
    </div>
  );
}

function LobbySkeleton() {
  return (
    <main className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-6 lg:grid-cols-12">
      <Skeleton className="h-10 lg:col-span-12" />
      <Skeleton className="h-80 lg:col-span-4" />
      <Skeleton className="h-80 lg:col-span-5" />
      <Skeleton className="h-80 lg:col-span-3" />
    </main>
  );
}
