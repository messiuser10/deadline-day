import { describe, expect, it } from 'vitest';
import {
  autoNominationPick,
  currentNominator,
  evaluateCandidate,
  isAuctionComplete,
  markUnsold,
  maxBidSummary,
  nominate,
  placeBid,
  runStallGuard,
  sellLot,
  swapTeamSlots,
  undoLastSale,
  validateBid,
  validateNomination,
  availablePlayers,
  AuctionRuleError,
  type AuctionPlayer,
  type AuctionState,
} from '../src';
import { basePool, fullSquad, giveRoster, mk, threeTeamState, twoTeamState } from './helpers';

/** A 4-3-3 squad (main positions) minus the given slot keys. */
function squadWithout(open: string[], overall = 80): AuctionPlayer[] {
  const keys = ['GK', 'LB', 'CB1', 'CB2', 'RB', 'CDM', 'CM1', 'CM2', 'LW', 'ST', 'RW'];
  return fullSquad('4-3-3', overall).filter((_, i) => !open.includes(keys[i]!));
}

/** Team B already full, so whole-game feasibility only concerns team A. */
function withFullB(players: AuctionPlayer[], aRoster: AuctionPlayer[] = []): AuctionState {
  const bSquad = fullSquad('4-3-3');
  let s = twoTeamState([...players, ...aRoster, ...bSquad], ['4-3-3', '4-3-3']);
  s = giveRoster(s, 'B', bSquad.map((p) => p.id));
  if (aRoster.length) s = giveRoster(s, 'A', aRoster.map((p) => p.id));
  return s;
}

describe('nomination', () => {
  const extra = [mk('GK', [], 80, 'gk-x'), mk('ST', [], 84, 'st-x'), mk('CB', [], 76, 'cb-x')];
  const state = twoTeamState([...basePool(['4-3-3', '4-3-3']), ...extra], ['4-3-3', '4-3-3']);

  it('starts with the first team in the order', () => {
    expect(currentNominator(state)).toEqual({ teamId: 'A', orderIndex: 0 });
  });

  it('rejects a nomination out of turn', () => {
    expect(validateNomination(state, 'B', 'st-x', 40)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
  });

  it('rejects an opening bid below base price or not whole', () => {
    expect(validateNomination(state, 'A', 'st-x', 39)).toMatchObject({ ok: false, code: 'BID_TOO_LOW', minBidM: 40 });
    expect(validateNomination(state, 'A', 'st-x', 40.5)).toMatchObject({ ok: false, code: 'NOT_WHOLE_NUMBER' });
  });

  it('opens a lot with the opening bid as the nominator’s first bid', () => {
    const s = nominate(state, 'A', 'st-x', 45);
    expect(s.lot).toMatchObject({ playerId: 'st-x', leaderId: 'A', currentBidM: 45, sequence: 1 });
    expect(s.status['st-x']).toBe('live');
    expect(validateNomination(s, 'A', 'gk-x', 40)).toMatchObject({ ok: false, code: 'LOT_IN_PROGRESS' });
  });

  it('throws a coded error when applying an illegal move', () => {
    expect(() => nominate(state, 'B', 'st-x', 40)).toThrowError(AuctionRuleError);
  });
});

describe('lineup check (NO_SLOT)', () => {
  it('rejects a player who cannot fit any open slot', () => {
    const gk2 = mk('GK', [], 82, 'gk2');
    const cb2 = mk('CB', [], 82, 'cb2');
    const s = withFullB([gk2, cb2, mk('ST', [], 80, 'st1'), mk('ST', [], 80, 'st2')], squadWithout(['ST']));
    expect(validateNomination(s, 'A', 'gk2', gk2.basePriceM)).toMatchObject({ ok: false, code: 'NO_SLOT' });
    expect(validateNomination(s, 'A', 'cb2', cb2.basePriceM)).toMatchObject({ ok: false, code: 'NO_SLOT' });
  });

  it('accepts Messi for an open ST slot but not for an open CB slot', () => {
    const messi = mk('CAM', ['ST', 'RW', 'RM'], 89, 'messi');
    const s = withFullB([messi, mk('ST', [], 80, 'st1')], squadWithout(['ST']));
    expect(validateNomination(s, 'A', 'messi', messi.basePriceM)).toMatchObject({ ok: true });
    const t = withFullB([messi, mk('CB', [], 80, 'cb1')], squadWithout(['CB1']));
    expect(validateNomination(t, 'A', 'messi', messi.basePriceM)).toMatchObject({ ok: false, code: 'NO_SLOT' });
  });
});

describe('feasibility (WOULD_STRAND_TEAM)', () => {
  // A (4-3-3) only needs a RW; B (4-4-2) only needs its two strikers.
  // RW-eligible: x (CAM, alt ST and RW) and w1. ST-eligible: x and s1.
  // If A takes x, B can only find one striker.
  const x = mk('CAM', ['ST', 'RW'], 85, 'x');
  const w1 = mk('RW', [], 80, 'w1');
  const s1 = mk('ST', [], 80, 's1');
  const aSquad = squadWithout(['RW']);
  const bSquad = fullSquad('4-4-2').filter((p) => p.position !== 'ST');
  let state = twoTeamState([...aSquad, ...bSquad, x, w1, s1], ['4-3-3', '4-4-2']);
  state = giveRoster(state, 'A', aSquad.map((p) => p.id));
  state = giveRoster(state, 'B', bSquad.map((p) => p.id));

  it('rejects a purchase that would leave another team unable to fill a slot', () => {
    expect(validateNomination(state, 'A', 'x', x.basePriceM)).toMatchObject({ ok: false, code: 'WOULD_STRAND_TEAM' });
    expect(validateNomination(state, 'A', 'w1', w1.basePriceM)).toMatchObject({ ok: true });
  });

  it('allows the same player for the team that needs him', () => {
    const bTurn = { ...state, nominationIndex: 1 };
    expect(validateNomination(bTurn, 'B', 'x', x.basePriceM)).toMatchObject({ ok: true });
  });

  it('also blocks a bid that would strand a team', () => {
    const bTurn = nominate({ ...state, nominationIndex: 1 }, 'B', 'x', x.basePriceM);
    expect(validateBid(bTurn, 'A', x.basePriceM + 1)).toMatchObject({ ok: false, code: 'WOULD_STRAND_TEAM' });
  });
});

describe('reserve rule', () => {
  // A needs a ST and a RW with $100M left. The cheapest available ST is b-st (76, base 23).
  const st80 = mk('ST', [], 80, 'st80');
  const st90 = mk('ST', [], 90, 'st90');
  const rw78 = mk('RW', [], 78, 'rw78');
  const rw84 = mk('RW', [], 84, 'rw84');
  const aSquad = squadWithout(['ST', 'RW']);
  const bSquad = squadWithout(['ST', 'RW']);
  let state = twoTeamState(
    [...aSquad, ...bSquad, st80, st90, rw78, rw84, mk('ST', [], 76, 'b-st'), mk('RW', [], 76, 'b-rw')],
    ['4-3-3', '4-3-3'],
  );
  state = giveRoster(state, 'A', aSquad.map((p) => p.id));
  state = giveRoster(state, 'B', bSquad.map((p) => p.id));
  state = { ...state, teams: state.teams.map((t) => (t.id === 'A' ? { ...t, budgetM: 100 } : t)) };

  it('computes max bid as budget minus the cheapest fill of the other open slots', () => {
    const ev = evaluateCandidate(state, 'A', 'rw84');
    expect(ev.reserveM).toBe(23);
    expect(ev.maxBidM).toBe(77);
  });

  it('blocks a bid that would leave the team unable to afford its remaining slots', () => {
    const live = nominate({ ...state, nominationIndex: 1 }, 'B', 'rw84', 40);
    expect(validateBid(live, 'A', 78)).toMatchObject({ ok: false, code: 'OVER_MAX_BID', maxBidM: 77 });
    expect(validateBid(live, 'A', 77)).toMatchObject({ ok: true, maxBidM: 77 });
  });

  it('shows a UI max bid of budget minus all open slots except the priciest', () => {
    expect(maxBidSummary(state, 'A')).toBe(77);
  });
});

describe('bidding', () => {
  const players = [...basePool(['4-3-3', '4-4-2', '4-4-2']), mk('ST', [], 84, 'st')];
  const state = nominate(twoTeamState(players, ['4-3-3', '4-4-2']), 'A', 'st', 40);

  it('requires the minimum increment and a whole number', () => {
    expect(validateBid(state, 'B', 40)).toMatchObject({ ok: false, code: 'BID_TOO_LOW', minBidM: 41 });
    expect(validateBid(state, 'B', 41.5)).toMatchObject({ ok: false, code: 'NOT_WHOLE_NUMBER' });
    expect(validateBid(state, 'B', 41)).toMatchObject({ ok: true });
  });

  it('does not let a team outbid itself', () => {
    expect(validateBid(state, 'A', 50)).toMatchObject({ ok: false, code: 'ALREADY_LEADING' });
  });

  it('orders two simultaneous bids: the first wins, the second is told OUTBID and can bid again', () => {
    const three = nominate(threeTeamState(players, ['4-3-3', '4-4-2', '4-4-2']), 'A', 'st', 40);
    // B and C both saw 40 and both send 41. B's arrives first.
    const afterB = placeBid(three, 'B', 41, 40);
    expect(validateBid(afterB, 'C', 41, 40)).toMatchObject({ ok: false, code: 'OUTBID', currentBidM: 41 });
    expect(afterB.lot?.leaderId).toBe('B');
    expect(validateBid(afterB, 'C', 42, 41)).toMatchObject({ ok: true });
  });

  it('records each bid', () => {
    expect(placeBid(state, 'B', 45).lot?.bids).toEqual([
      { teamId: 'A', amountM: 40 },
      { teamId: 'B', amountM: 45 },
    ]);
  });
});

describe('sale and auto end', () => {
  const players = [...basePool(['4-3-3', '4-4-2']), mk('ST', [], 84, 'st')];

  it('sells to the leader, deducts money, assigns the slot and advances the order', () => {
    const s = placeBid(nominate(twoTeamState(players, ['4-3-3', '4-4-2']), 'A', 'st', 40), 'B', 50);
    const { state, sale } = sellLot(s);
    expect(sale).toMatchObject({ playerId: 'st', teamId: 'B', priceM: 50, autoFilled: false });
    const b = state.teams.find((t) => t.id === 'B')!;
    expect(b.budgetM).toBe(950);
    expect(Object.values(b.lineup)).toContain('st');
    expect(state.status.st).toBe('sold');
    expect(state.lot).toBeNull();
    expect(currentNominator(state)?.teamId).toBe('B');
  });

  it('ends when every team has 11 players and marks the rest unsold', () => {
    const aSquad = squadWithout(['ST']);
    const st = mk('ST', [], 80, 'last-st');
    const spare = mk('ST', [], 79, 'spare');
    let s = withFullB([st, spare], aSquad);
    expect(isAuctionComplete(s)).toBe(false);
    s = sellLot(nominate(s, 'A', 'last-st', st.basePriceM)).state;
    expect(isAuctionComplete(s)).toBe(true);
    expect(currentNominator(s)).toBeNull();
    expect(markUnsold(s).status.spare).toBe('unsold');
  });

  it('skips full teams in the nomination loop', () => {
    const s = withFullB([mk('ST', [], 80, 'st')]);
    expect(currentNominator({ ...s, nominationIndex: 1 })?.teamId).toBe('A');
  });

  it('undoes the last sale while no lot is live', () => {
    const sold = sellLot(placeBid(nominate(twoTeamState(players, ['4-3-3', '4-4-2']), 'A', 'st', 40), 'B', 60)).state;
    const { state, undone } = undoLastSale(sold);
    expect(undone.playerId).toBe('st');
    expect(state.teams.find((t) => t.id === 'B')!.budgetM).toBe(1000);
    expect(state.status.st).toBe('available');
    expect(currentNominator(state)?.teamId).toBe('A');
  });

  it('undoes while the next lot has only its opening bid, but not once someone has bid', () => {
    const sold = sellLot(placeBid(nominate(twoTeamState(players, ['4-3-3', '4-4-2']), 'A', 'st', 40), 'B', 60)).state;
    const nominator = currentNominator(sold)!.teamId;
    const other = nominator === 'A' ? 'B' : 'A';
    const next = availablePlayers(sold).find((p) => validateNomination(sold, nominator, p.id, p.basePriceM).ok)!;
    const opened = nominate(sold, nominator, next.id, next.basePriceM);
    const { state } = undoLastSale(opened);
    expect(state.lot).toBeNull();
    expect(state.status[next.id]).toBe('available');
    expect(state.status.st).toBe('available');
    const bid = placeBid(opened, other, next.basePriceM + 1);
    expect(() => undoLastSale(bid)).toThrow(/bids/);
  });
});

describe('auto-nomination and stall guard', () => {
  it('auto-nominates the highest overall legal player at base price', () => {
    const st88 = mk('ST', [], 88, 'st88');
    const s = withFullB([mk('CB', [], 91, 'cb-best'), st88, mk('ST', [], 80, 'st80')], squadWithout(['ST']));
    expect(autoNominationPick(s, 'A')).toEqual({ playerId: 'st88', openingBidM: st88.basePriceM });
  });

  it('auto-fills a team that cannot afford anything, never going below zero', () => {
    let s = withFullB(
      [mk('ST', [], 80, 'st'), mk('RW', [], 80, 'rw'), mk('ST', [], 82, 'st2'), mk('RW', [], 82, 'rw2')],
      squadWithout(['ST', 'RW']),
    );
    s = { ...s, teams: s.teams.map((t) => (t.id === 'A' ? { ...t, budgetM: 10 } : t)) };
    const { state, fills } = runStallGuard(s);
    const a = state.teams.find((t) => t.id === 'A')!;
    expect(a.roster).toHaveLength(11);
    expect(fills.map((f) => f.playerId).sort()).toEqual(['rw', 'st']);
    expect(fills.every((f) => f.autoFilled && f.teamId === 'A')).toBe(true);
    expect(a.budgetM).toBe(0);
    expect(fills.reduce((sum, f) => sum + f.priceM, 0)).toBe(10);
  });

  it('leaves a team that can still proceed alone', () => {
    const s = withFullB([mk('ST', [], 80, 'st'), mk('ST', [], 79, 'st2')], squadWithout(['ST']));
    expect(runStallGuard(s).fills).toEqual([]);
  });
});

describe('manager swaps', () => {
  it('swaps two players who can play each other’s slot and refuses otherwise', () => {
    const cm = mk('CM', ['CDM', 'CAM'], 85, 'cm');
    const cdm = mk('CDM', ['CM'], 84, 'cdm');
    const st = mk('ST', [], 84, 'st');
    const s = giveRoster(twoTeamState([cm, cdm, st], ['4-3-3', '4-3-3']), 'A', ['cm', 'cdm', 'st']);
    const a = s.teams[0]!;
    const cmSlot = Object.keys(a.lineup).find((k) => a.lineup[k] === 'cm')!;
    expect(swapTeamSlots(s, 'A', cmSlot, 'CDM').teams[0]!.lineup.CDM).toBe('cm');
    expect(() => swapTeamSlots(s, 'A', 'ST', 'CDM')).toThrowError(/other slot/);
  });
});
