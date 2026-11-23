/**
 * Client-side previews of the auction rules (the server is still the judge of every action):
 * rebuild the engine state from the auction view, then ask the engine which players a team can buy.
 */
import { createAuctionState, evaluateCandidate, type AuctionState, type FormationId } from '@deadline-day/engine';
import { ratingTier, type AuctionView, type ParticipantView, type RatingTier } from '@deadline-day/protocol';

export function toEngineState(view: AuctionView, participants: readonly ParticipantView[]): AuctionState {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const base = createAuctionState({
    players: view.players.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      altPositions: p.altPositions,
      overall: p.overall,
      marketValueM: p.marketValueM,
      basePriceM: p.basePriceM,
      positionRank: p.positionRank,
    })),
    teams: view.teams.map((t) => ({
      id: t.participantId,
      name: byId.get(t.participantId)?.teamName ?? 'Team',
      formation: (byId.get(t.participantId)?.formation ?? '4-3-3') as FormationId,
      budgetM: t.budgetM,
    })),
    nominationOrder: view.teams.map((t) => t.participantId),
    minIncrementM: view.timers.minIncrementM,
  });
  return {
    ...base,
    status: Object.fromEntries(view.players.map((p) => [p.id, p.status])),
    teams: base.teams.map((team) => {
      const tv = view.teams.find((t) => t.participantId === team.id)!;
      return {
        ...team,
        lineup: Object.fromEntries(tv.slots.map((s) => [s.key, s.playerId])),
        roster: tv.slots
          .filter((s) => s.playerId)
          .map((s) => ({ playerId: s.playerId!, priceM: s.priceM ?? 0, autoFilled: s.autoFilled, lotSequence: null })),
      };
    }),
    lot: view.lot
      ? {
          sequence: view.lot.sequence,
          playerId: view.lot.playerId,
          nominatorId: view.lot.nominatorId,
          openingBidM: view.lot.openingBidM,
          currentBidM: view.lot.currentBidM,
          leaderId: view.lot.leaderId,
          bids: view.lot.bids.map((b) => ({ teamId: b.participantId, amountM: b.amountM })),
          autoNominated: view.lot.autoNominated,
        }
      : null,
  };
}

export interface Buyability {
  ok: boolean;
  maxBidM: number;
  reason: string | null;
}

/** For every available player: can this team buy him (at base price at least), and its max bid for him. */
export function buyability(state: AuctionState, teamId: string): Map<string, Buyability> {
  const out = new Map<string, Buyability>();
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return out;
  for (const [id, status] of Object.entries(state.status)) {
    if (status !== 'available') continue;
    const p = state.players[id]!;
    if (team.roster.length >= 11) {
      out.set(id, { ok: false, maxBidM: 0, reason: 'Your XI is full' });
      continue;
    }
    const ev = evaluateCandidate(state, teamId, id);
    const maxBidM = Number.isFinite(ev.maxBidM) ? Math.max(0, Math.floor(ev.maxBidM)) : 0;
    const reason = !ev.fits
      ? 'No open slot he can play'
      : !ev.feasible
        ? 'Would leave a team unable to fill a slot'
        : p.basePriceM > maxBidM
          ? 'Over your max bid'
          : null;
    out.set(id, { ok: reason === null, maxBidM, reason });
  }
  return out;
}

export const TIER_LABEL: Record<RatingTier, string> = { elite: 'Elite', gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };

/** Generic tier colours (no card design from any existing game). */
export const TIER_CLASS: Record<RatingTier, string> = {
  elite: 'bg-gradient-to-br from-fuchsia-400 to-violet-600 text-white',
  gold: 'bg-gold-400 text-night-950',
  silver: 'bg-slate-300 text-night-950',
  bronze: 'bg-amber-700 text-white',
};

export const TIER_RING: Record<RatingTier, string> = {
  elite: 'ring-fuchsia-400/60',
  gold: 'ring-gold-400/60',
  silver: 'ring-slate-300/50',
  bronze: 'ring-amber-600/50',
};

export const tierOf = ratingTier;

export function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(-1)[0]! : name;
}

export function seconds(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s);
}
