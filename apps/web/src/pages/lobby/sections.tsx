import { useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { FORMATION_IDS } from '@deadline-day/engine';
import { CHAT_MAX_LENGTH, type BotLevel, type GameSnapshot, type LobbyUpdate, type ParticipantView, type PublicSettings, type UserView } from '@deadline-day/protocol';
import { del, patch, post, put } from '../../lib/api';
import { money, prefersReducedMotion } from '../../lib/format';
import { useAction } from '../../hooks/useAction';
import { Button, Card, CardTitle, cx, Modal, Pill, Segmented } from '../../components/ui';
import { SignInGate } from '../../components/SignInGate';
import { randomTeamDraft, TeamBadge, TeamEditor, teamErrors, type TeamDraft } from '../../components/team';
import { toast } from '../../stores/toast';

export interface LobbyCtx {
  snap: GameSnapshot;
  me: UserView | null | undefined;
  mine: ParticipantView | undefined;
  canHost: boolean;
  settings: PublicSettings;
  base: string;
}

const enabledFormations = (s: PublicSettings) => FORMATION_IDS.filter((f) => s.formationsEnabled.includes(f));
const lockedFormation = (snap: GameSnapshot) => (snap.game.settings.formationRule === 'forced' ? snap.game.settings.forcedFormation : null);

// ---------------------------------------------------------------------------
// Your team / join

export function MyTeamCard({ ctx, onLeft }: { ctx: LobbyCtx; onLeft: () => void }) {
  const { mine, snap, base } = ctx;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TeamDraft | null>(null);
  const { run, pending } = useAction();
  if (!mine) return null;

  const open = () => {
    setDraft({ teamName: mine.teamName, color: mine.color, monogram: mine.monogram, formation: mine.formation });
    setEditing(true);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft || Object.keys(teamErrors(draft)).length) return;
    const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => mine[k as keyof TeamDraft] !== v));
    if (Object.keys(changed).length === 0) return setEditing(false);
    const res = await run('save', () => patch<{ state: LobbyUpdate }>(`${base}/team`, changed));
    if (res) setEditing(false);
  };
  const others = snap.participants.filter((p) => p.id !== mine.id).map((p) => p.color);

  return (
    <Card>
      <CardTitle
        action={
          <Button size="sm" variant="secondary" onClick={open}>
            Edit team
          </Button>
        }
      >
        Your team
      </CardTitle>
      <div className="flex items-center gap-3">
        <TeamBadge color={mine.color} monogram={mine.monogram} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{mine.teamName}</p>
          <p className="text-sm text-white/60">
            {mine.formation} · {money(mine.budgetRemainingM)}
          </p>
        </div>
      </div>
      {!mine.isHost && (
        <button
          type="button"
          className="mt-3 text-xs text-white/50 underline-offset-2 hover:text-red-300 hover:underline"
          onClick={async () => {
            if (!window.confirm('Leave this game?')) return;
            const res = await run('leave', () => post<{ ok: true }>(`${base}/leave`));
            if (res) onLeft();
          }}
        >
          {pending === 'leave' ? 'Leaving…' : 'Leave game'}
        </button>
      )}
      <Modal open={editing} onClose={() => setEditing(false)} title="Edit team">
        {draft && (
          <form onSubmit={save} className="flex flex-col gap-4">
            <TeamEditor
              draft={draft}
              onChange={setDraft}
              enabledFormations={enabledFormations(ctx.settings)}
              lockedFormation={lockedFormation(snap)}
              takenColors={others}
              showErrors
            />
            <Button type="submit" size="lg" loading={pending === 'save'}>
              Save
            </Button>
          </form>
        )}
      </Modal>
    </Card>
  );
}

export function JoinCard({ ctx, onJoined }: { ctx: LobbyCtx; onJoined: () => void }) {
  const { me, snap, base } = ctx;
  const full = snap.participants.length >= snap.game.settings.maxTeams;
  const [draft, setDraft] = useState<TeamDraft | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const { run, pending } = useAction();
  const taken = snap.participants.map((p) => p.color);

  useEffect(() => {
    if (me && !draft) setDraft(randomTeamDraft(me.displayName, taken));
  }, [me, draft, taken]);

  if (full) {
    return (
      <Card id="join">
        <CardTitle>Game full</CardTitle>
        <p className="text-sm text-white/60">All {snap.game.settings.maxTeams} places are taken. You can still watch.</p>
      </Card>
    );
  }
  return (
    <Card id="join" className="ring-pitch-400/40">
      <CardTitle>Join this game</CardTitle>
      {!me ? (
        <SignInGate why="Pick a name to join. Anyone can watch without one." />
      ) : draft ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitted(true);
            if (Object.keys(teamErrors(draft)).length) return;
            const res = await run('join', () => post<{ state: LobbyUpdate }>(`${base}/join`, draft), 'You are in. Press Ready when your team is set.');
            if (res) onJoined();
          }}
        >
          <TeamEditor
            draft={draft}
            onChange={setDraft}
            enabledFormations={enabledFormations(ctx.settings)}
            lockedFormation={lockedFormation(snap)}
            takenColors={taken}
            showErrors={submitted}
          />
          <Button type="submit" size="lg" loading={pending === 'join'}>
            Join with this team
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Participants

const LEVELS: { value: BotLevel; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export function ParticipantsCard({ ctx }: { ctx: LobbyCtx }) {
  const { snap, canHost, base } = ctx;
  const [openId, setOpenId] = useState<string | null>(null);
  const { run, pending } = useAction();
  const s = snap.game.settings;
  const full = snap.participants.length >= s.maxTeams;

  return (
    <Card>
      <CardTitle action={<span className="text-sm text-white/50">{snap.participants.length}/{s.maxTeams}</span>}>Teams</CardTitle>
      <ul className="flex flex-col gap-2">
        {snap.participants.map((p) => {
          const isMine = p.id === ctx.mine?.id;
          const open = openId === p.id && canHost && !isMine;
          return (
            <li key={p.id} className={cx('rounded-xl bg-night-950/50 ring-1', isMine ? 'ring-pitch-400/40' : 'ring-white/5')}>
              <div className="flex min-h-14 items-center gap-3 px-3 py-2">
                <span className="relative">
                  <TeamBadge color={p.color} monogram={p.monogram} />
                  <span
                    className={cx('absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-night-900', p.isConnected ? 'bg-pitch-400' : 'bg-white/25')}
                    title={p.isConnected ? 'Online' : 'Offline'}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold">
                    {p.isHost && (
                      <span className="text-gold-400" title="Host" aria-label="Host">
                        ♛
                      </span>
                    )}
                    <span className="truncate">{p.teamName}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-white/55">
                    <span className="truncate">{p.managerName}</span>
                    {p.isGuest && <Pill>Guest</Pill>}
                    <span className="sr-only">{p.isConnected ? 'online' : 'offline'}</span>
                  </p>
                </div>
                <span className="font-display text-sm tracking-wide text-white/80">{p.formation}</span>
                {p.isBot || p.isHost ? (
                  <Pill tone="green">{p.isBot ? 'Bot' : 'Host'}</Pill>
                ) : p.isReady ? (
                  <Pill tone="green">✓ Ready</Pill>
                ) : (
                  <Pill>Not ready</Pill>
                )}
                {canHost && !isMine && (
                  <button
                    type="button"
                    className="grid size-9 place-items-center rounded-lg text-white/60 hover:bg-white/10"
                    aria-label={`Manage ${p.teamName}`}
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : p.id)}
                  >
                    ⋯
                  </button>
                )}
              </div>
              {open && (
                <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-3 py-2">
                  {p.isBot ? (
                    <>
                      <div className="min-w-48 flex-1">
                        <Segmented<BotLevel>
                          label="Bot level"
                          value={p.botLevel ?? 'medium'}
                          options={LEVELS}
                          onChange={(level) => void run('level', () => patch<{ state: LobbyUpdate }>(`${base}/participants/${p.id}`, { level }))}
                        />
                      </div>
                      <Button size="sm" variant="danger" loading={pending === 'remove'} onClick={() => void run('remove', () => del<{ state: LobbyUpdate }>(`${base}/participants/${p.id}`))}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                          size="sm"
                          variant="secondary"
                          loading={pending === 'host'}
                          onClick={() => {
                            if (window.confirm(`Make ${p.managerName} the host? You lose host controls.`)) {
                              void run('host', () => post<{ state: LobbyUpdate }>(`${base}/host`, { participantId: p.id }), `${p.managerName} is now the host`);
                            }
                          }}
                        >
                          Make host
                        </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={pending === 'kick'}
                        onClick={() => {
                          if (window.confirm(`Remove ${p.teamName} from the game?`)) void run('kick', () => del<{ state: LobbyUpdate }>(`${base}/participants/${p.id}`));
                        }}
                      >
                        Kick
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canHost && s.botsAllowed && !full && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-white/60">Add bot:</span>
          {LEVELS.map((l) => (
            <Button key={l.value} size="sm" variant="secondary" loading={pending === `bot-${l.value}`} onClick={() => void run(`bot-${l.value}`, () => post<{ state: LobbyUpdate }>(`${base}/bots`, { level: l.value }))}>
              + {l.label}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Nomination order

export function NominationOrderCard({ ctx }: { ctx: LobbyCtx }) {
  const { snap, canHost, base } = ctx;
  const { run, pending } = useAction();
  const [shuffling, setShuffling] = useState(false);
  const byId = new Map(snap.participants.map((p) => [p.id, p]));
  const order = snap.game.nominationOrder.filter((id) => byId.has(id));

  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    void run('order', () => put<{ state: LobbyUpdate }>(`${base}/order`, { order: next }));
  };
  const randomize = async () => {
    if (!prefersReducedMotion()) setShuffling(true);
    await run('shuffle', () => post<{ state: LobbyUpdate }>(`${base}/order/randomize`));
    setTimeout(() => setShuffling(false), 450);
  };

  return (
    <Card>
      <CardTitle
        action={
          canHost && order.length > 1 ? (
            <Button size="sm" variant="secondary" onClick={() => void randomize()} loading={pending === 'shuffle'}>
              Randomize
            </Button>
          ) : null
        }
      >
        Nomination order
      </CardTitle>
      <p className="mb-3 text-xs text-white/50">Teams nominate players in this order. It locks when the auction starts.</p>
      <ol className="flex flex-col gap-1.5">
        {order.map((id, i) => {
          const p = byId.get(id)!;
          return (
            <li
              key={id}
              className={cx('flex min-h-11 items-center gap-3 rounded-xl bg-night-950/40 px-3', shuffling && 'motion-safe:animate-[shuffle_450ms_ease-in-out]')}
              style={shuffling ? { animationDelay: `${i * 35}ms` } : undefined}
            >
              <span className="w-5 text-center font-display text-lg text-white/50">{i + 1}</span>
              <TeamBadge color={p.color} monogram={p.monogram} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.teamName}</span>
              {canHost && (
                <span className="flex gap-1">
                  <button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-25" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.teamName} up`}>
                    ↑
                  </button>
                  <button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-25" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.teamName} down`}>
                    ↓
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pool preview and AI clubs

export function PoolPreviewCard({ pool, live }: { pool: GameSnapshot['pool']; live: boolean }) {
  const groups = pool.groups.filter((g) => g.size > 0 || g.need > 0);
  return (
    <Card>
      <CardTitle action={live ? <Pill tone="green">Live</Pill> : <Pill>Locked</Pill>}>Auction pool</CardTitle>
      <p className="mb-3 text-xs text-white/50">
        {live ? 'Recalculated whenever a team joins, leaves or changes formation.' : 'Frozen when the auction started.'} Need is the slots to fill; extra
        players give the last picks a choice.
      </p>
      <div className="overflow-hidden rounded-xl ring-1 ring-white/5">
        <table className="w-full text-sm">
          <thead className="bg-night-950/60 text-xs uppercase tracking-wide text-white/50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">Pos</th>
              <th scope="col" className="px-2 py-2 text-right">Need</th>
              <th scope="col" className="px-2 py-2 text-right">Extra</th>
              <th scope="col" className="px-2 py-2 text-right">Pool</th>
              <th scope="col" className="px-3 py-2 text-right">Ratings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {groups.map((g) => {
              const short = g.taken < g.size;
              return (
                <tr key={g.group} className={short ? 'bg-red-500/10' : undefined}>
                  <th scope="row" className="px-3 py-2 text-left font-display font-semibold tracking-wide">{g.group}</th>
                  <td className="px-2 py-2 text-right tabular-nums">{g.need}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-white/60">+{g.extra}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{short ? `${g.taken}/${g.size}` : g.size}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white/70">
                    {g.minOverall === null ? '–' : g.minOverall === g.maxOverall ? g.maxOverall : `${g.minOverall}–${g.maxOverall}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-night-950/60 font-semibold">
            <tr>
              <th scope="row" className="px-3 py-2 text-left">Total</th>
              <td className="px-2 py-2 text-right tabular-nums">{pool.totalNeed}</td>
              <td className="px-2 py-2 text-right tabular-nums text-white/60">+{pool.totalSize - pool.totalNeed}</td>
              <td className="px-2 py-2 text-right tabular-nums text-pitch-400">{pool.totalSize}</td>
              <td className="px-3 py-2 text-right text-xs font-normal text-white/60">{pool.unsold} unsold</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {pool.shortfalls.length > 0 && (
        <p className="mt-3 text-sm text-red-300" role="alert">
          Not enough players for {pool.shortfalls.map((s) => s.group).join(', ')}. Change formations or remove a team.
        </p>
      )}
    </Card>
  );
}

export function AiClubsCard({ ai }: { ai: GameSnapshot['aiClubs'] }) {
  return (
    <Card>
      <CardTitle action={<span className="text-sm text-white/50">20-team league</span>}>AI clubs ({ai.count})</CardTitle>
      {ai.inLeague.length === 0 && ai.count > 0 ? (
        <p className="text-sm text-white/60">{ai.count} clubs are drawn at random when the auction starts.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
          {ai.inLeague.map((c) => (
            <li key={c.id} className="flex min-h-10 items-center gap-2 rounded-lg bg-night-950/40 px-2.5">
              <span className="size-3 shrink-0 rounded-full ring-2" style={{ backgroundColor: c.primaryColor, ['--tw-ring-color' as string]: c.secondaryColor }} />
              <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
              <span className="text-xs tabular-nums text-white/50">{c.strength.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
      {ai.leftOut.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs uppercase tracking-wide text-white/40">Left out</p>
          <p className="text-sm text-white/50">{ai.leftOut.map((c) => c.name).join(', ')}</p>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Invite

export function InviteCard({ code }: { code: string }) {
  const link = `${window.location.origin}/lobby/${code}`;
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    if (!showQr || qr) return;
    void QRCode.toDataURL(link, { margin: 1, width: 240, color: { dark: '#0a0f1e', light: '#ffffff' } }).then(setQr);
  }, [showQr, qr, link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied', 'success');
    } catch {
      toast(link);
    }
  };
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <Card>
      <CardTitle>Invite</CardTitle>
      <p className="text-xs uppercase tracking-wide text-white/50">Game code</p>
      <p className="font-display text-4xl font-bold tracking-[0.25em] text-gold-400">{code}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          Copy link
        </Button>
        {canShare && (
          <Button size="sm" variant="secondary" onClick={() => void navigator.share({ title: 'Join my Deadline Day game', url: link }).catch(() => {})}>
            Share
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
          {showQr ? 'Hide QR code' : 'QR code'}
        </Button>
      </div>
      {showQr && (
        <div className="mt-3 flex justify-center">
          {qr ? <img src={qr} alt={`QR code for ${link}`} className="size-48 rounded-xl" /> : <div className="size-48 animate-pulse rounded-xl bg-white/10" />}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chat

export function ChatCard({ ctx, className }: { ctx: Pick<LobbyCtx, 'snap' | 'me' | 'mine' | 'base'>; className?: string }) {
  const { snap, mine, base } = ctx;
  const [body, setBody] = useState('');
  const { run, pending } = useAction();
  const listRef = useRef<HTMLOListElement>(null);
  const count = snap.chat.length;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    const res = await run('chat', () => post<{ message: unknown }>(`${base}/chat`, { body: text }));
    if (res) setBody('');
  };

  return (
    <Card className={cx('flex flex-col', className)}>
      <CardTitle>Chat</CardTitle>
      <ol ref={listRef} className="flex max-h-80 min-h-32 flex-1 flex-col gap-2 overflow-y-auto pr-1" aria-live="polite">
        {snap.chat.length === 0 && <li className="m-auto text-sm text-white/40">No messages yet. Say hello.</li>}
        {snap.chat.map((m) => (
          <li key={m.id} className="text-sm">
            <span className={cx('font-semibold', m.userId === ctx.me?.id ? 'text-pitch-400' : 'text-white/80')}>{m.name}</span>{' '}
            <span className="break-words text-white/80">{m.body}</span>
          </li>
        ))}
      </ol>
      {mine ? (
        <form onSubmit={send} className="mt-3 flex gap-2">
          <input
            aria-label="Message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={CHAT_MAX_LENGTH}
            placeholder="Message"
            className="min-h-11 min-w-0 flex-1 rounded-xl bg-night-950/70 px-3 text-base ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-2 focus:ring-pitch-400 sm:text-sm"
          />
          <Button type="submit" loading={pending === 'chat'} disabled={!body.trim()}>
            Send
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-white/40">Join the game to chat.</p>
      )}
    </Card>
  );
}

