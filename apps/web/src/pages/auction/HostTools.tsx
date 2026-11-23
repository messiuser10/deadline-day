import { useEffect, useState } from 'react';
import { DISCONNECT_PROMPT_MS, type ParticipantView } from '@deadline-day/protocol';
import { Button, cx, Modal } from '../../components/ui';
import { TeamBadge } from '../../components/team';
import { useAction } from '../../hooks/useAction';
import { post } from '../../lib/api';
import { money } from '../../lib/format';
import { seconds } from '../../lib/auction';
import { serverNow } from '../../lib/socket';
import { useGameStore } from '../../stores/game';
import type { RoomCtx } from './parts';

/** A button that asks "Sure?" on the first tap and acts on the second. */
function ConfirmButton({ label, confirm, onConfirm, disabled, loading }: { label: string; confirm: string; onConfirm: () => void; disabled?: boolean; loading?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <Button
      variant="danger"
      disabled={disabled}
      loading={loading}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirm : label}
    </Button>
  );
}

export function HostSheet({ ctx, open, onClose }: { ctx: RoomCtx; open: boolean; onClose: () => void }) {
  const { auction, base } = ctx;
  const { run, pending } = useAction();
  const act = (key: string, success?: string) => void run(key, () => post(`${base}/auction/${key}`), success);
  const running = auction.phase !== 'complete';
  return (
    <Modal open={open} onClose={onClose} title="Host controls">
      <div className="flex flex-col gap-4">
        <section className="grid grid-cols-2 gap-2">
          {auction.paused ? (
            <Button className="col-span-2" size="lg" onClick={() => act('resume')} loading={pending === 'resume'}>
              Resume
            </Button>
          ) : (
            <Button className="col-span-2" size="lg" variant="gold" onClick={() => act('pause')} loading={pending === 'pause'} disabled={!running && !auction.countdownDeadline}>
              Pause
            </Button>
          )}
          <Button variant="secondary" onClick={() => act('skip', 'Auto-nominated')} disabled={!running || auction.phase !== 'nominating' || !!auction.paused} loading={pending === 'skip'}>
            Skip nomination
          </Button>
          <Button variant="secondary" onClick={() => act('extend', 'Added 10 seconds')} loading={pending === 'extend'}>
            Extend +10 s
          </Button>
        </section>
        <p className="text-xs text-white/50">Skip auto-nominates the best player the team on the clock can afford, at base price.</p>

        <section className="flex flex-col gap-2 rounded-2xl bg-night-950/50 p-3 ring-1 ring-white/5">
          <h3 className="text-sm font-semibold text-white/80">Fix a mistake</h3>
          <ConfirmButton
            label="Undo last sale"
            confirm="Tap again to undo the last sale"
            onConfirm={() => act('undo')}
            disabled={!auction.canUndo}
            loading={pending === 'undo'}
          />
          <p className="text-xs text-white/50">Refunds the money and returns the player. Only while the next lot has no bids.</p>
          <ConfirmButton label="End auction early" confirm="Tap again: auto-fill every open slot" onConfirm={() => act('end')} disabled={!running} loading={pending === 'end'} />
          <ConfirmButton label="Reset auction" confirm="Tap again: cancel every purchase" onConfirm={() => act('reset')} loading={pending === 'reset'} />
        </section>

        <DisconnectedTeams ctx={ctx} />
      </div>
    </Modal>
  );
}

function useDisconnected(ctx: RoomCtx, now: number): ParticipantView[] {
  return ctx.snap.participants.filter(
    (p) => !p.isBot && p.control === 'human' && !p.isConnected && p.disconnectedAt !== null && now - p.disconnectedAt > DISCONNECT_PROMPT_MS,
  );
}

function DisconnectedTeams({ ctx }: { ctx: RoomCtx }) {
  const teams = useDisconnected(ctx, serverNow());
  const taken = ctx.snap.participants.filter((p) => !p.isBot && p.control !== 'human');
  const { run, pending } = useAction();
  const control = (pid: string, mode: 'bot' | 'auto' | 'human') => void run(`control-${pid}-${mode}`, () => post(`${ctx.base}/participants/${pid}/control`, { mode }));
  if (!teams.length && !taken.length) return null;
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-night-950/50 p-3 ring-1 ring-white/5">
      <h3 className="text-sm font-semibold text-white/80">Teams without a manager</h3>
      {teams.map((p) => (
        <div key={p.id} className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm">
            <TeamBadge color={p.color} monogram={p.monogram} size="sm" />
            {p.teamName}: {p.managerName} has been away for over a minute
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => control(p.id, 'bot')} loading={pending === `control-${p.id}-bot`}>
              Bot takes over
            </Button>
            <Button size="sm" variant="secondary" onClick={() => control(p.id, 'auto')} loading={pending === `control-${p.id}-auto`}>
              Auto-nominate only
            </Button>
          </div>
        </div>
      ))}
      {taken.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">
            {p.teamName}: {p.control === 'bot' ? 'bot in charge' : 'auto-nominate only'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => control(p.id, 'human')} loading={pending === `control-${p.id}-human`}>
            Give back
          </Button>
        </div>
      ))}
    </section>
  );
}

/** Host-only banner when a manager has been away for over a minute. */
export function DisconnectBanner({ ctx, now, onOpen }: { ctx: RoomCtx; now: number; onOpen: () => void }) {
  const teams = useDisconnected(ctx, now);
  if (!ctx.canHost || !teams.length || ctx.auction.phase === 'complete') return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-sm ring-1 ring-red-400/25">
      <span>
        {teams.map((t) => t.teamName).join(', ')} {teams.length === 1 ? 'has' : 'have'} lost connection. Choose who runs {teams.length === 1 ? 'that team' : 'those teams'}.
      </span>
      <Button size="sm" variant="secondary" onClick={onOpen}>
        Choose
      </Button>
    </div>
  );
}

/** My team was handed to a bot (or auto-nominate) while I was away. */
export function ReclaimBanner({ ctx }: { ctx: RoomCtx }) {
  const { mine, base } = ctx;
  const { run, pending } = useAction();
  if (!mine || mine.isBot || mine.control === 'human') return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-gold-400/10 px-4 py-3 text-sm ring-1 ring-gold-400/30">
      <span>{mine.control === 'bot' ? 'A bot is running your team while you were away.' : 'Your team is on auto-nominate while you were away.'}</span>
      <Button size="sm" onClick={() => void run('reclaim', () => post(`${base}/participants/${mine.id}/control`, { mode: 'human' }), 'You are back in charge')} loading={pending === 'reclaim'}>
        Take back control
      </Button>
    </div>
  );
}

export function PausedBanner({ ctx }: { ctx: RoomCtx }) {
  const { auction, canHost, base } = ctx;
  const { run, pending } = useAction();
  if (!auction.paused) return null;
  const what = auction.paused.timer === 'lot' ? 'lot' : auction.paused.timer === 'nomination' ? 'nomination' : 'season countdown';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gold-400 px-4 py-3 text-night-950 shadow-lg shadow-gold-400/20" role="status">
      <div>
        <p className="font-display text-xl font-bold uppercase tracking-wide">Paused</p>
        <p className="text-sm">
          {auction.paused.byName} paused the {what} with {seconds(auction.paused.remainingMs)} s left.
        </p>
      </div>
      {canHost && (
        <Button className="bg-night-950 text-white hover:bg-night-800" onClick={() => void run('resume', () => post(`${base}/auction/resume`))} loading={pending === 'resume'}>
          Resume
        </Button>
      )}
    </div>
  );
}

/** Full-screen SOLD stamp for a moment after each lot. */
export function SoldOverlay({ ctx }: { ctx: RoomCtx }) {
  const sale = useGameStore((s) => s.lastSale);
  const clear = useGameStore((s) => s.clearSale);
  useEffect(() => {
    if (!sale) return;
    const id = setTimeout(clear, 2400);
    return () => clearTimeout(id);
  }, [sale, clear]);
  if (!sale) return null;
  const p = ctx.playersById.get(sale.playerId);
  const team = ctx.teamsById.get(sale.participantId);
  const mine = sale.participantId === ctx.mine?.id;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-night-950/50 px-4 backdrop-blur-[2px]" role="status" aria-live="assertive">
      <div className="flex max-w-sm flex-col items-center gap-2 rounded-3xl bg-night-800 px-8 py-6 text-center shadow-2xl ring-2 ring-gold-400 motion-safe:animate-[bump_0.35s_ease-out]">
        <p className={cx('-rotate-3 font-display text-6xl font-bold uppercase tracking-widest', mine ? 'text-pitch-400' : 'text-gold-400')}>Sold</p>
        <p className="font-display text-2xl font-semibold uppercase">{p?.name}</p>
        {team && (
          <p className="flex items-center gap-2 text-sm text-white/75">
            <TeamBadge color={team.color} monogram={team.monogram} size="sm" />
            {mine ? 'to you' : `to ${team.teamName}`}
          </p>
        )}
        <p className="font-display text-4xl font-bold text-gold-400">{money(sale.priceM)}</p>
      </div>
    </div>
  );
}
