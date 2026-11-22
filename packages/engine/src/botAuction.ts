/**
 * Runs a whole auction with no clock: bots nominate and bid, teams without a bot level are only
 * auto-nominated (they never bid). Used by the sim CLI, the admin Test Auction and tests.
 */
import {
  autoNominationPick,
  currentNominator,
  evaluateCandidate,
  isAuctionComplete,
  markUnsold,
  nominate,
  runStallGuard,
  sellLot,
  type AuctionState,
  type Sale,
} from './auction';
import { botBidDecision, botNominationPick, botValuation } from './bots';
import { Rng } from './rng';

export interface BotAuctionResult {
  state: AuctionState;
  /** Every sale in order, lots and auto-fills. */
  sales: Sale[];
  lots: number;
  bids: number;
}

export function runBotAuction(initial: AuctionState, seed: number): BotAuctionResult {
  let state = initial;
  let lots = 0;
  let bids = 0;
  const maxLots = state.teams.length * 11 * 3 + 10;

  for (;;) {
    state = runStallGuard(state).state;
    if (isAuctionComplete(state)) break;
    if (lots >= maxLots) throw new Error('Bot auction did not finish');

    const turn = currentNominator(state);
    if (!turn) break;
    const nominator = state.teams.find((t) => t.id === turn.teamId)!;
    const pick = nominator.botLevel ? botNominationPick(state, nominator.id) : autoNominationPick(state, nominator.id);
    if (!pick) throw new Error(`${nominator.name} has nothing to nominate after the stall guard`);
    state = nominate(state, nominator.id, pick.playerId, pick.openingBidM, { auto: !nominator.botLevel });
    lots++;

    // Availability is frozen while a lot is live, so each team's checks and valuation hold for the whole lot.
    const lot = state.lot!;
    const lotRng = Rng.from(seed, 'lot', lot.sequence);
    const bidders = state.teams
      .filter((t) => t.botLevel)
      .map((t) => {
        const ev = evaluateCandidate(state, t.id, lot.playerId);
        const value = botValuation(state, t.id, lot.playerId, t.botLevel!, Rng.from(seed, 'value', lot.sequence, t.id));
        return { team: t, ok: ev.fits && ev.feasible, maxBidM: ev.maxBidM, value };
      })
      .filter((b) => b.ok);

    for (;;) {
      const offers = bidders
        .map((b) => ({ b, amount: botBidDecision(state, b.team.id, b.value, b.maxBidM, lotRng) }))
        .filter((o): o is { b: (typeof bidders)[number]; amount: number } => o.amount !== null);
      if (!offers.length) break;
      const { b, amount } = lotRng.pick(offers);
      const live = state.lot!;
      state = {
        ...state,
        lot: { ...live, currentBidM: amount, leaderId: b.team.id, bids: [...live.bids, { teamId: b.team.id, amountM: amount }] },
      };
      bids++;
    }
    state = sellLot(state).state;
  }
  state = markUnsold(state);
  return { state, sales: state.sales, lots, bids };
}
