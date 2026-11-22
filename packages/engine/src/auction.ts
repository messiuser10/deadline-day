/**
 * Auction rules (section 8) as pure state transitions. The server keeps the authoritative state,
 * validates every nomination and bid with these functions, and applies them in one serialized queue.
 *
 * Transitions return new state objects and never mutate their input.
 */
import { FORBIDDEN, hungarian, maxBipartiteMatching } from './assignment';
import { FORMATIONS, type FormationId } from './formations';
import { assignLineup, isEligible, playerGroups, swapSlots, type Lineup } from './lineup';
import { GROUPS, slotGroup, type Group } from './positions';

export const SQUAD_SIZE = 11;

export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard'];

export interface AuctionPlayer {
  id: string;
  name: string;
  position: Group;
  altPositions: Group[];
  overall: number;
  marketValueM: number;
  basePriceM: number;
  positionRank?: number;
  seedClub?: string | null;
  nationality?: string | null;
}

export interface RosterEntry {
  playerId: string;
  priceM: number;
  autoFilled: boolean;
  lotSequence: number | null;
}

export interface AuctionTeam {
  id: string;
  name: string;
  formation: FormationId;
  budgetM: number;
  roster: RosterEntry[];
  lineup: Lineup;
  botLevel: BotLevel | null;
}

export type PlayerStatus = 'available' | 'live' | 'sold' | 'unsold';

export interface LotBid {
  teamId: string;
  amountM: number;
}

export interface LiveLot {
  sequence: number;
  playerId: string;
  nominatorId: string;
  openingBidM: number;
  currentBidM: number;
  leaderId: string;
  bids: LotBid[];
  autoNominated: boolean;
}

export interface Sale {
  /** Lot sequence, or null for an auto-fill. */
  sequence: number | null;
  playerId: string;
  teamId: string;
  priceM: number;
  autoFilled: boolean;
  autoNominated: boolean;
  /** Nomination index before this sale, so an undo can restore it. */
  nominationIndexBefore: number;
}

export interface AuctionState {
  players: Record<string, AuctionPlayer>;
  status: Record<string, PlayerStatus>;
  teams: AuctionTeam[];
  /** Team ids in nomination order. Loops; full teams are skipped. */
  nominationOrder: string[];
  nominationIndex: number;
  lot: LiveLot | null;
  /** Number of lots opened so far. */
  lotSequence: number;
  minIncrementM: number;
  sales: Sale[];
}

export interface CreateAuctionInput {
  players: readonly AuctionPlayer[];
  teams: readonly { id: string; name: string; formation: FormationId; budgetM: number; botLevel?: BotLevel | null }[];
  nominationOrder?: readonly string[];
  minIncrementM?: number;
}

export function createAuctionState(input: CreateAuctionInput): AuctionState {
  const players = Object.fromEntries(input.players.map((p) => [p.id, p]));
  const order = input.nominationOrder ? [...input.nominationOrder] : input.teams.map((t) => t.id);
  const ids = new Set(input.teams.map((t) => t.id));
  if (order.length !== ids.size || !order.every((id) => ids.has(id))) {
    throw new Error('nominationOrder must list every team exactly once');
  }
  return {
    players,
    status: Object.fromEntries(input.players.map((p) => [p.id, 'available' as PlayerStatus])),
    teams: input.teams.map((t) => ({
      id: t.id,
      name: t.name,
      formation: t.formation,
      budgetM: t.budgetM,
      roster: [],
      lineup: Object.fromEntries(FORMATIONS[t.formation].slots.map((s) => [s.key, null])),
      botLevel: t.botLevel ?? null,
    })),
    nominationOrder: order,
    nominationIndex: 0,
    lot: null,
    lotSequence: 0,
    minIncrementM: input.minIncrementM ?? 1,
    sales: [],
  };
}

// ---------------------------------------------------------------------------
// Errors

export type AuctionErrorCode =
  | 'AUCTION_COMPLETE'
  | 'NO_LOT'
  | 'LOT_IN_PROGRESS'
  | 'NOT_YOUR_TURN'
  | 'UNKNOWN_TEAM'
  | 'UNKNOWN_PLAYER'
  | 'PLAYER_UNAVAILABLE'
  | 'NOT_WHOLE_NUMBER'
  | 'BID_TOO_LOW'
  | 'OUTBID'
  | 'ALREADY_LEADING'
  | 'NO_SLOT'
  | 'WOULD_STRAND_TEAM'
  | 'OVER_MAX_BID'
  | 'NOTHING_TO_UNDO'
  | 'ILLEGAL_SWAP';

export interface RuleViolation {
  code: AuctionErrorCode;
  message: string;
  currentBidM?: number;
  minBidM?: number;
  maxBidM?: number;
}

export type RuleCheck = { ok: true; maxBidM: number } | ({ ok: false } & RuleViolation);

export class AuctionRuleError extends Error {
  readonly code: AuctionErrorCode;
  constructor(readonly violation: RuleViolation) {
    super(violation.message);
    this.code = violation.code;
  }
}

const fail = (code: AuctionErrorCode, message: string, extra: Partial<RuleViolation> = {}): RuleCheck => ({
  ok: false,
  code,
  message,
  ...extra,
});

function orThrow(check: RuleCheck): number {
  if (!check.ok) throw new AuctionRuleError(check);
  return check.maxBidM;
}

// ---------------------------------------------------------------------------
// Queries

export function getTeam(state: AuctionState, teamId: string): AuctionTeam | undefined {
  return state.teams.find((t) => t.id === teamId);
}

function requireTeam(state: AuctionState, teamId: string): AuctionTeam {
  const t = getTeam(state, teamId);
  if (!t) throw new AuctionRuleError({ code: 'UNKNOWN_TEAM', message: `No team ${teamId} in this auction` });
  return t;
}

export function rosterPlayers(state: AuctionState, team: AuctionTeam): AuctionPlayer[] {
  return team.roster.map((r) => state.players[r.playerId]!);
}

export function isTeamFull(team: AuctionTeam): boolean {
  return team.roster.length >= SQUAD_SIZE;
}

export function isAuctionComplete(state: AuctionState): boolean {
  return state.teams.every(isTeamFull);
}

export function playersBought(state: AuctionState): number {
  return state.teams.reduce((s, t) => s + t.roster.length, 0);
}

/** Players that are not sold and not live, optionally excluding one more. */
export function availablePlayers(state: AuctionState, excludeId?: string): AuctionPlayer[] {
  const out: AuctionPlayer[] = [];
  for (const [id, status] of Object.entries(state.status)) {
    if (status === 'available' && id !== excludeId) out.push(state.players[id]!);
  }
  return out;
}

/** Cheapest base price among the given players eligible for each group (Infinity when none). */
export function minBaseByGroup(players: readonly AuctionPlayer[]): Record<Group, number> {
  const out = Object.fromEntries(GROUPS.map((g) => [g, Infinity])) as Record<Group, number>;
  for (const p of players) {
    for (const g of playerGroups(p)) if (p.basePriceM < out[g]) out[g] = p.basePriceM;
  }
  return out;
}

/** Whose turn it is to nominate: the next team in the loop that still has open slots. */
export function currentNominator(state: AuctionState): { teamId: string; orderIndex: number } | null {
  const n = state.nominationOrder.length;
  for (let k = 0; k < n; k++) {
    const orderIndex = (((state.nominationIndex + k) % n) + n) % n;
    const teamId = state.nominationOrder[orderIndex]!;
    const t = getTeam(state, teamId);
    if (t && !isTeamFull(t)) return { teamId, orderIndex };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core checks: lineup fit + reserve, and whole-game feasibility

const NO_SUPPLY = 1e6;

export interface CandidateEvaluation {
  /** Roster plus this player can still be matched one to one to the formation (else NO_SLOT). */
  fits: boolean;
  /** Every team can still fill every open slot after this sale (else WOULD_STRAND_TEAM). */
  feasible: boolean;
  /** Cheapest way to fill the team's other open slots at base prices. */
  reserveM: number;
  /** budget_remaining - reserve. */
  maxBidM: number;
}

/**
 * Lineup check plus reserve for one candidate, in one assignment: the roster and the candidate must
 * be placed (forbidden otherwise), and each slot left open costs the cheapest base price still
 * available among players eligible for it. Minimizing the total picks the open slots that are
 * cheapest to fill, which is the reserve.
 */
function fitAndReserve(
  team: AuctionTeam,
  roster: readonly AuctionPlayer[],
  minBase: Record<Group, number>,
): { fits: boolean; reserveM: number } {
  if (roster.length > SQUAD_SIZE) return { fits: false, reserveM: Infinity };
  const slots = FORMATIONS[team.formation].slots;
  const dummies = SQUAD_SIZE - roster.length;
  const cost = slots.map((slot) => {
    const row: number[] = roster.map((p) => (isEligible(p, slot.type) ? 0 : FORBIDDEN));
    const open = minBase[slotGroup(slot.type)];
    for (let d = 0; d < dummies; d++) row.push(Number.isFinite(open) ? open : NO_SUPPLY);
    return row;
  });
  const choice = hungarian(cost);
  let placed = 0;
  let reserve = 0;
  choice.forEach((col, row) => {
    const c = cost[row]![col]!;
    if (col < roster.length) {
      if (c < FORBIDDEN) placed++;
    } else {
      reserve = c >= NO_SUPPLY ? Infinity : reserve + c;
    }
  });
  return { fits: placed === roster.length, reserveM: reserve };
}

/**
 * Whole-game feasibility after a hypothetical sale of `playerId` to `buyerId`: all open slots of all
 * teams must be matchable to distinct players, where a team's own roster may only fill its own slots
 * and any available player (not sold, not live, not this one) may fill any slot he is eligible for.
 * Each roster already fits its formation, so by the Mendelsohn-Dulmage theorem a matching that covers
 * every slot can also be chosen to use every roster player.
 */
export function feasibleAfterSale(state: AuctionState, buyerId: string, playerId: string): boolean {
  const available = availablePlayers(state, playerId);
  const availByGroup = new Map<Group, number[]>();
  available.forEach((p, i) => {
    for (const g of playerGroups(p)) {
      const list = availByGroup.get(g) ?? [];
      list.push(i);
      availByGroup.set(g, list);
    }
  });

  const adjacency: number[][] = [];
  let rightCount = available.length;
  for (const team of state.teams) {
    const roster = rosterPlayers(state, team);
    if (team.id === buyerId) roster.push(state.players[playerId]!);
    if (roster.length >= SQUAD_SIZE) continue;
    const offset = rightCount;
    rightCount += roster.length;
    for (const slot of FORMATIONS[team.formation].slots) {
      const adj: number[] = [];
      roster.forEach((p, i) => {
        if (isEligible(p, slot.type)) adj.push(offset + i);
      });
      adj.push(...(availByGroup.get(slotGroup(slot.type)) ?? []));
      if (adj.length === 0) return false;
      adjacency.push(adj);
    }
  }
  if (adjacency.length === 0) return true;
  return maxBipartiteMatching(adjacency, rightCount).size === adjacency.length;
}

/** Lineup check, feasibility and max bid for one team and one player (ignores turn, lot and amount). */
export function evaluateCandidate(state: AuctionState, teamId: string, playerId: string): CandidateEvaluation {
  const team = requireTeam(state, teamId);
  const player = state.players[playerId];
  if (!player) throw new AuctionRuleError({ code: 'UNKNOWN_PLAYER', message: `No player ${playerId}` });
  const roster = [...rosterPlayers(state, team), player];
  const minBase = minBaseByGroup(availablePlayers(state, playerId));
  const { fits, reserveM } = fitAndReserve(team, roster, minBase);
  const maxBidM = team.budgetM - reserveM;
  if (!fits) return { fits, feasible: false, reserveM, maxBidM };
  return { fits, feasible: feasibleAfterSale(state, teamId, playerId), reserveM, maxBidM };
}

function candidateViolation(state: AuctionState, team: AuctionTeam, player: AuctionPlayer, amountM: number): RuleCheck {
  if (isTeamFull(team)) return fail('NO_SLOT', `${team.name} already has ${SQUAD_SIZE} players`);
  const ev = evaluateCandidate(state, team.id, player.id);
  if (!ev.fits) return fail('NO_SLOT', `${player.name} cannot fit any open slot in ${team.name}'s ${team.formation}`);
  if (!ev.feasible) {
    return fail('WOULD_STRAND_TEAM', `Buying ${player.name} would leave a team unable to fill a slot`);
  }
  const maxBidM = Math.max(0, Math.floor(ev.maxBidM));
  if (amountM > ev.maxBidM) {
    return fail('OVER_MAX_BID', `Your max bid is ${maxBidM}: you must keep enough to fill your other open slots`, {
      maxBidM,
    });
  }
  return { ok: true, maxBidM };
}

/**
 * The most a team could bid on a single player right now, for the UI: budget minus the cheapest
 * fill of all its open slots except the one this player would take (the priciest of those).
 */
export function maxBidSummary(state: AuctionState, teamId: string): number {
  const team = requireTeam(state, teamId);
  if (isTeamFull(team)) return 0;
  const minBase = minBaseByGroup(availablePlayers(state));
  const slots = FORMATIONS[team.formation].slots;
  const costs = slots
    .filter((s) => team.lineup[s.key] === null)
    .map((s) => minBase[slotGroup(s.type)]);
  if (costs.some((c) => !Number.isFinite(c))) return 0;
  const total = costs.reduce((s, c) => s + c, 0) - Math.max(...costs);
  return Math.max(0, team.budgetM - total);
}

// ---------------------------------------------------------------------------
// Nomination

export function validateNomination(state: AuctionState, teamId: string, playerId: string, openingBidM: number): RuleCheck {
  if (isAuctionComplete(state)) return fail('AUCTION_COMPLETE', 'Every team already has 11 players');
  if (state.lot) return fail('LOT_IN_PROGRESS', 'A player is already up for auction');
  const team = getTeam(state, teamId);
  if (!team) return fail('UNKNOWN_TEAM', `No team ${teamId} in this auction`);
  const turn = currentNominator(state);
  if (!turn || turn.teamId !== teamId) return fail('NOT_YOUR_TURN', 'It is not your turn to nominate');
  const player = state.players[playerId];
  if (!player) return fail('UNKNOWN_PLAYER', `No player ${playerId} in this pool`);
  if (state.status[playerId] !== 'available') return fail('PLAYER_UNAVAILABLE', `${player.name} is not available`);
  if (!Number.isInteger(openingBidM)) return fail('NOT_WHOLE_NUMBER', 'Bids are whole millions');
  if (openingBidM < player.basePriceM) {
    return fail('BID_TOO_LOW', `The opening bid must be at least the base price of ${player.basePriceM}`, {
      minBidM: player.basePriceM,
    });
  }
  return candidateViolation(state, team, player, openingBidM);
}

export function nominate(
  state: AuctionState,
  teamId: string,
  playerId: string,
  openingBidM: number,
  options: { auto?: boolean } = {},
): AuctionState {
  orThrow(validateNomination(state, teamId, playerId, openingBidM));
  const sequence = state.lotSequence + 1;
  return {
    ...state,
    status: { ...state.status, [playerId]: 'live' },
    lotSequence: sequence,
    lot: {
      sequence,
      playerId,
      nominatorId: teamId,
      openingBidM,
      currentBidM: openingBidM,
      leaderId: teamId,
      bids: [{ teamId, amountM: openingBidM }],
      autoNominated: options.auto ?? false,
    },
  };
}

/**
 * Auto-nomination on timer expiry: the available player with the highest overall who passes the
 * checks and whose base price fits under the reserve rule, at base price.
 */
export function autoNominationPick(state: AuctionState, teamId: string): { playerId: string; openingBidM: number } | null {
  const team = getTeam(state, teamId);
  if (!team || isTeamFull(team)) return null;
  const candidates = availablePlayers(state).sort(
    (a, b) => b.overall - a.overall || (a.positionRank ?? 0) - (b.positionRank ?? 0) || a.id.localeCompare(b.id),
  );
  for (const p of candidates) {
    if (p.basePriceM > team.budgetM) continue;
    const ev = evaluateCandidate(state, teamId, p.id);
    if (ev.fits && ev.feasible && p.basePriceM <= ev.maxBidM) return { playerId: p.id, openingBidM: p.basePriceM };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bidding

export function minNextBid(state: AuctionState): number | null {
  return state.lot ? state.lot.currentBidM + state.minIncrementM : null;
}

/**
 * Validate a bid. `seenBidM` is the price the bidder's screen showed; when someone else got in
 * first, a now-too-low bid is reported as OUTBID (with the new price) rather than BID_TOO_LOW.
 */
export function validateBid(state: AuctionState, teamId: string, amountM: number, seenBidM?: number): RuleCheck {
  const lot = state.lot;
  if (!lot) return fail('NO_LOT', 'No player is up for auction');
  const team = getTeam(state, teamId);
  if (!team) return fail('UNKNOWN_TEAM', `No team ${teamId} in this auction`);
  if (lot.leaderId === teamId) return fail('ALREADY_LEADING', 'You are already the highest bidder', { currentBidM: lot.currentBidM });
  if (!Number.isInteger(amountM)) return fail('NOT_WHOLE_NUMBER', 'Bids are whole millions');
  const minBidM = lot.currentBidM + state.minIncrementM;
  if (amountM < minBidM) {
    if (seenBidM !== undefined && seenBidM < lot.currentBidM) {
      return fail('OUTBID', `You were outbid, the price is now ${lot.currentBidM}`, { currentBidM: lot.currentBidM, minBidM });
    }
    return fail('BID_TOO_LOW', `The next bid must be at least ${minBidM}`, { currentBidM: lot.currentBidM, minBidM });
  }
  return candidateViolation(state, team, state.players[lot.playerId]!, amountM);
}

export function placeBid(state: AuctionState, teamId: string, amountM: number, seenBidM?: number): AuctionState {
  orThrow(validateBid(state, teamId, amountM, seenBidM));
  const lot = state.lot!;
  return {
    ...state,
    lot: { ...lot, currentBidM: amountM, leaderId: teamId, bids: [...lot.bids, { teamId, amountM }] },
  };
}

// ---------------------------------------------------------------------------
// Sales

function withPlayerAdded(
  state: AuctionState,
  teamId: string,
  playerId: string,
  priceM: number,
  meta: { autoFilled: boolean; lotSequence: number | null },
): AuctionState {
  const teams = state.teams.map((t) => {
    if (t.id !== teamId) return t;
    const roster = [...t.roster, { playerId, priceM, autoFilled: meta.autoFilled, lotSequence: meta.lotSequence }];
    const result = assignLineup(
      t.formation,
      roster.map((r) => state.players[r.playerId]!),
      t.lineup,
    );
    if (!result.valid) throw new Error(`${state.players[playerId]?.name} does not fit ${t.name}'s lineup`);
    return { ...t, roster, budgetM: t.budgetM - priceM, lineup: result.lineup };
  });
  return { ...state, teams, status: { ...state.status, [playerId]: 'sold' } };
}

/** Lot timer hit zero: sell to the leader at the current bid and advance the nomination order. */
export function sellLot(state: AuctionState): { state: AuctionState; sale: Sale } {
  const lot = state.lot;
  if (!lot) throw new AuctionRuleError({ code: 'NO_LOT', message: 'No player is up for auction' });
  const sale: Sale = {
    sequence: lot.sequence,
    playerId: lot.playerId,
    teamId: lot.leaderId,
    priceM: lot.currentBidM,
    autoFilled: false,
    autoNominated: lot.autoNominated,
    nominationIndexBefore: state.nominationIndex,
  };
  const nominatorPos = state.nominationOrder.indexOf(lot.nominatorId);
  const next = withPlayerAdded({ ...state, lot: null }, lot.leaderId, lot.playerId, lot.currentBidM, {
    autoFilled: false,
    lotSequence: lot.sequence,
  });
  return {
    state: { ...next, nominationIndex: nominatorPos + 1, sales: [...state.sales, sale] },
    sale,
  };
}

/** Cancel the live lot without a sale (host reset or end-early); the player becomes available again. */
export function voidLot(state: AuctionState): AuctionState {
  if (!state.lot) return state;
  return { ...state, lot: null, status: { ...state.status, [state.lot.playerId]: 'available' } };
}

/** True when the team can legally nominate some available player at his base price. */
export function canTeamProceed(state: AuctionState, teamId: string): boolean {
  const team = requireTeam(state, teamId);
  if (isTeamFull(team)) return true;
  const candidates = availablePlayers(state)
    .filter((p) => p.basePriceM <= team.budgetM)
    .sort((a, b) => a.basePriceM - b.basePriceM || b.overall - a.overall || a.id.localeCompare(b.id));
  for (const p of candidates) {
    const ev = evaluateCandidate(state, teamId, p.id);
    if (ev.fits && ev.feasible && p.basePriceM <= ev.maxBidM) return true;
  }
  return false;
}

/**
 * Fill every open slot of one team with the cheapest available eligible players at base price,
 * paying only what it has left when money runs out (the balance never goes below zero).
 */
export function autoFillTeam(state: AuctionState, teamId: string): { state: AuctionState; fills: Sale[] } {
  let current = state;
  const fills: Sale[] = [];
  for (;;) {
    const team = requireTeam(current, teamId);
    if (isTeamFull(team)) break;
    const roster = rosterPlayers(current, team);
    const candidates = availablePlayers(current).sort(
      (a, b) => a.basePriceM - b.basePriceM || b.overall - a.overall || a.id.localeCompare(b.id),
    );
    const pick = candidates.find((p) => {
      const fit = assignLineup(team.formation, [...roster, p]);
      return fit.valid && feasibleAfterSale(current, teamId, p.id);
    });
    if (!pick) throw new Error(`No available player can fill ${team.name}'s open slots`);
    const priceM = Math.min(pick.basePriceM, Math.max(0, team.budgetM));
    const sale: Sale = {
      sequence: null,
      playerId: pick.id,
      teamId,
      priceM,
      autoFilled: true,
      autoNominated: false,
      nominationIndexBefore: current.nominationIndex,
    };
    current = withPlayerAdded(current, teamId, pick.id, priceM, { autoFilled: true, lotSequence: null });
    current = { ...current, sales: [...current.sales, sale] };
    fills.push(sale);
  }
  return { state: current, fills };
}

/**
 * Stall guard, run after every sale: any team with open slots that cannot legally nominate anything
 * is auto-filled. Repeats until no team is stuck, which guarantees the auction finishes.
 */
export function runStallGuard(state: AuctionState): { state: AuctionState; fills: Sale[] } {
  if (state.lot) return { state, fills: [] };
  let current = state;
  const fills: Sale[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const teamId of current.nominationOrder) {
      const team = requireTeam(current, teamId);
      if (isTeamFull(team) || canTeamProceed(current, teamId)) continue;
      const res = autoFillTeam(current, teamId);
      current = res.state;
      fills.push(...res.fills);
      changed = true;
    }
  }
  return { state: current, fills };
}

/** End early: void any live lot and auto-fill every team's open slots. */
export function endAuctionEarly(state: AuctionState): { state: AuctionState; fills: Sale[] } {
  let current = voidLot(state);
  const fills: Sale[] = [];
  for (const teamId of current.nominationOrder) {
    const res = autoFillTeam(current, teamId);
    current = res.state;
    fills.push(...res.fills);
  }
  return { state: markUnsold(current), fills };
}

/** Once every team is full, every player still available is unsold. */
export function markUnsold(state: AuctionState): AuctionState {
  const status = { ...state.status };
  for (const [id, s] of Object.entries(status)) if (s === 'available') status[id] = 'unsold';
  return { ...state, status };
}

/** Undo the last sale while no lot is live: refund, return the player, restore the nomination turn. */
export function undoLastSale(initial: AuctionState): { state: AuctionState; undone: Sale } {
  // Allowed while the next lot has no bids beyond the nominator's opening bid; that lot is voided.
  if (initial.lot && initial.lot.bids.length > 1) {
    throw new AuctionRuleError({ code: 'LOT_IN_PROGRESS', message: 'Cannot undo once the next lot has bids' });
  }
  const sale = initial.sales[initial.sales.length - 1];
  if (!sale) throw new AuctionRuleError({ code: 'NOTHING_TO_UNDO', message: 'No sale to undo' });
  const state = voidLot(initial);
  const status = { ...state.status };
  for (const [id, s] of Object.entries(status)) if (s === 'unsold') status[id] = 'available';
  status[sale.playerId] = 'available';
  const teams = state.teams.map((t) => {
    if (t.id !== sale.teamId) return t;
    const roster = t.roster.filter((r) => r.playerId !== sale.playerId);
    const lineup = Object.fromEntries(Object.entries(t.lineup).map(([k, v]) => [k, v === sale.playerId ? null : v]));
    return { ...t, roster, lineup, budgetM: t.budgetM + sale.priceM };
  });
  return {
    state: { ...state, teams, status, sales: state.sales.slice(0, -1), nominationIndex: sale.nominationIndexBefore },
    undone: sale,
  };
}

/** Manager drag-and-drop: swap two slots when both players can legally play the other's slot. */
export function swapTeamSlots(state: AuctionState, teamId: string, slotA: string, slotB: string): AuctionState {
  const team = requireTeam(state, teamId);
  const byId = new Map(rosterPlayers(state, team).map((p) => [p.id, p]));
  const lineup = swapSlots(team.formation, team.lineup, byId, slotA, slotB);
  if (!lineup) throw new AuctionRuleError({ code: 'ILLEGAL_SWAP', message: 'Both players must be able to play the other slot' });
  return { ...state, teams: state.teams.map((t) => (t.id === teamId ? { ...t, lineup } : t)) };
}
