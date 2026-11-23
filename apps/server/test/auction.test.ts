/* eslint-disable @typescript-eslint/no-explicit-any -- test responses are loosely typed JSON */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { REVEAL_STEP_MS, REVEAL_TAIL_MS, SEASON_COUNTDOWN_MS } from '@deadline-day/protocol';
import { buildApp } from '../src/app';
import { auditLog, bids, gamePool, games, lots, participants } from '../src/db/schema';
import { ADMIN_NAME, Client, createGame, guest, signUp, team, testApp, type TestApp } from './helpers';

let t: TestApp;

beforeEach(async () => {
  t = await testApp({ botDelayMs: null });
});

afterEach(async () => {
  await t.close();
});

interface Setup {
  code: string;
  gameId: string;
  host: Client;
  /** Client per participant id (humans only). */
  clients: Map<string, Client>;
  /** Participant ids in nomination order. */
  order: string[];
}

/** A started game: the host plus `humans` more human teams and the given bots, in join order. */
async function startGame(humans = 1, botLevels: ('easy' | 'medium' | 'hard')[] = [], settings: Record<string, unknown> = {}): Promise<Setup> {
  const host = await signUp(t.app, 'hosty');
  const code = await createGame(host, 'Deadline Test', settings);
  const others: Client[] = [];
  for (let i = 0; i < humans; i++) {
    const c = await guest(t.app, `Player ${i + 1}`);
    const res = await c.post(`/api/games/${code}/join`, team(`Team ${i + 1}`));
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    others.push(c);
  }
  for (const level of botLevels) await host.post(`/api/games/${code}/bots`, { level, formation: '4-3-3' });
  const start = await host.post(`/api/games/${code}/start`, { force: true });
  if (start.status !== 202) throw new Error(JSON.stringify(start.body));
  const snap = (await host.get(`/api/games/${code}`)).body.snapshot;
  const clients = new Map<string, Client>();
  const all = [host, ...others];
  for (const c of all) {
    const me = (await c.get('/api/auth/me')).body.user;
    const p = snap.participants.find((x: any) => x.userId === me.id);
    clients.set(p.id, c);
  }
  return { code, gameId: snap.game.id, host, clients, order: snap.game.nominationOrder };
}

const view = async (s: Setup) => (await s.host.get(`/api/games/${s.code}`)).body.snapshot.auction;

/** Move the running clock into the past and let the timer handler run. */
async function expire(s: Setup, which: 'lot' | 'nomination' | 'countdown') {
  const past = Date.now() - 1;
  const set = which === 'lot' ? { lotDeadline: past } : which === 'nomination' ? { nominationDeadline: past } : { countdownDeadline: past };
  t.db.update(games).set(set).where(eq(games.id, s.gameId)).run();
  await t.app.games.auction.tick(s.gameId);
}

/** Available players sorted by base price (cheapest first), optionally of one main position. */
function available(v: any, position?: string): any[] {
  return v.players
    .filter((p: any) => p.status === 'available' && (!position || p.position === position))
    .sort((a: any, b: any) => a.basePriceM - b.basePriceM || b.overall - a.overall);
}

async function nominate(s: Setup, pid: string, player: any, openingBidM = player.basePriceM) {
  return s.clients.get(pid)!.post(`/api/games/${s.code}/auction/nominate`, { playerId: player.id, openingBidM });
}

async function bid(s: Setup, pid: string, amountM: number, extra: Record<string, unknown> = {}) {
  return s.clients.get(pid)!.post(`/api/games/${s.code}/auction/bid`, { amountM, ...extra });
}

function auditActions(gameId: string): string[] {
  return t.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.gameId, gameId))
    .all()
    .map((a) => a.action);
}

describe('nomination', () => {
  it('opens with the first team in the order on the nomination clock', async () => {
    const s = await startGame(1);
    const v = await view(s);
    expect(v.phase).toBe('nominating');
    expect(v.nominatorId).toBe(s.order[0]);
    expect(v.nominationDeadline - Date.now()).toBeGreaterThan(25_000);
    expect(v.lot).toBeNull();
    expect(v.totalSlots).toBe(22);
    expect(v.teams.map((x: any) => x.participantId)).toEqual(s.order);
    expect(v.teams.every((x: any) => x.budgetM === 1000 && x.maxBidM > 0 && x.maxBidM < 1000)).toBe(true);
  });

  it('rejects a nomination out of turn, from outsiders and when logged out', async () => {
    const s = await startGame(1);
    const v = await view(s);
    const player = available(v)[0];
    const out = await nominate(s, s.order[1]!, player);
    expect(out.status).toBe(409);
    expect(out.body.error.code).toBe('NOT_YOUR_TURN');

    const stranger = await guest(t.app, 'Stranger');
    const res = await stranger.post(`/api/games/${s.code}/auction/nominate`, { playerId: player.id, openingBidM: player.basePriceM });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_IN_GAME');

    const anon = new Client(t.app);
    expect((await anon.post(`/api/games/${s.code}/auction/nominate`, { playerId: player.id, openingBidM: 5 })).status).toBe(401);
  });

  it('validates the opening bid and the player', async () => {
    const s = await startGame(1);
    const nominator = s.order[0]!;
    const player = available(await view(s))[0];
    expect((await nominate(s, nominator, player, player.basePriceM - 1)).body.error.code).toBe('BID_TOO_LOW');
    expect((await nominate(s, nominator, player, player.basePriceM + 0.5)).body.error.code).toBe('NOT_WHOLE_NUMBER');
    expect((await nominate(s, nominator, { id: 'nobody', basePriceM: 5 })).body.error.code).toBe('UNKNOWN_PLAYER');
    expect((await nominate(s, nominator, player, 999)).body.error.code).toBe('OVER_MAX_BID');

    const ok = await nominate(s, nominator, player);
    expect(ok.status).toBe(200);
    const lot = ok.body.auction.lot;
    expect(lot.playerId).toBe(player.id);
    expect(lot.leaderId).toBe(nominator);
    expect(lot.currentBidM).toBe(player.basePriceM);
    expect(lot.bids).toHaveLength(1);
    expect(ok.body.auction.phase).toBe('bidding');
    expect(ok.body.auction.lotDeadline - Date.now()).toBeGreaterThan(15_000);
    expect(ok.body.auction.players.find((p: any) => p.id === player.id).status).toBe('live');
    expect((await nominate(s, nominator, available(ok.body.auction)[0])).body.error.code).toBe('LOT_IN_PROGRESS');
  });

  it('auto-nominates the best legal player at base price when the nomination clock runs out', async () => {
    const s = await startGame(1);
    const before = await view(s);
    await expire(s, 'nomination');
    const v = await view(s);
    const best = before.players.filter((p: any) => p.status === 'available').sort((a: any, b: any) => b.overall - a.overall || a.positionRank - b.positionRank)[0];
    expect(v.lot.autoNominated).toBe(true);
    expect(v.lot.nominatorId).toBe(s.order[0]);
    expect(v.lot.playerId).toBe(best.id);
    expect(v.lot.currentBidM).toBe(best.basePriceM);
  });
});

describe('bidding', () => {
  it('enforces increments, no self-outbidding and the lot being bid on', async () => {
    const s = await startGame(1);
    const [a, b] = s.order as [string, string];
    const player = available(await view(s))[3];
    await nominate(s, a, player);
    expect((await bid(s, a, player.basePriceM + 1)).body.error.code).toBe('ALREADY_LEADING');
    expect((await bid(s, b, player.basePriceM)).body.error.code).toBe('BID_TOO_LOW');
    expect((await bid(s, b, player.basePriceM + 1, { lotSequence: 99 })).body.error.code).toBe('LOT_CLOSED');
    const ok = await bid(s, b, player.basePriceM + 1, { lotSequence: 1, seenBidM: player.basePriceM });
    expect(ok.status).toBe(200);
    expect(ok.body.bid).toMatchObject({ currentBidM: player.basePriceM + 1, leaderId: b, sequence: 1 });
    const v = await view(s);
    expect(v.lot.leaderId).toBe(b);
    expect(v.lot.bids.map((x: any) => x.amountM)).toEqual([player.basePriceM, player.basePriceM + 1]);
  });

  it('orders two simultaneous bids: one wins, the other gets OUTBID with the new price and can bid again', async () => {
    const s = await startGame(2);
    const [a, b, c] = s.order as [string, string, string];
    const player = available(await view(s))[5];
    const open = player.basePriceM;
    await nominate(s, a, player);
    const [r1, r2] = await Promise.all([bid(s, b, open + 1, { seenBidM: open }), bid(s, c, open + 1, { seenBidM: open })]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    const loserId = r1.status === 409 ? b : c;
    expect(loser.body.error.code).toBe('OUTBID');
    expect(loser.body.error.details.currentBidM).toBe(open + 1);
    const again = await bid(s, loserId, open + 2, { seenBidM: open + 1 });
    expect(again.status).toBe(200);
    const v = await view(s);
    expect(v.lot.bids).toHaveLength(3);
    expect(v.lot.leaderId).toBe(loserId);
  });

  it('rejects a bid for a player who cannot fit any open slot (NO_SLOT)', async () => {
    const s = await startGame(1);
    const [a, b] = s.order as [string, string];
    const keeper = available(await view(s), 'GK')[0];
    await nominate(s, a, keeper);
    await expire(s, 'lot');
    let v = await view(s);
    expect(v.teams.find((x: any) => x.participantId === a).slots.find((x: any) => x.type === 'GK').playerId).toBe(keeper.id);
    expect(v.nominatorId).toBe(b);

    // A keeps its turn for later; B nominates another keeper and A, whose only GK slot is full, cannot bid.
    const second = available(v, 'GK')[0];
    await nominate(s, b, second);
    v = await view(s);
    expect(v.lot.eligibility[a]).toMatchObject({ ok: false, code: 'NO_SLOT' });
    const res = await bid(s, a, second.basePriceM + 1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_SLOT');
  });

  it('applies the reserve rule: a bid above budget minus reserve is rejected', async () => {
    const s = await startGame(1);
    const [a, b] = s.order as [string, string];
    const star = (await view(s)).players.find((p: any) => p.status === 'available');
    await nominate(s, a, star);
    const v = await view(s);
    const max = v.lot.eligibility[b].maxBidM;
    expect(max).toBeGreaterThan(star.basePriceM);
    expect(max).toBeLessThan(1000);
    const over = await bid(s, b, max + 1);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('OVER_MAX_BID');
    expect(over.body.error.details.maxBidM).toBe(max);
    expect((await bid(s, b, max)).status).toBe(200);
    await expire(s, 'lot');
    const after = await view(s);
    const bTeam = after.teams.find((x: any) => x.participantId === b);
    expect(bTeam.budgetM).toBe(1000 - max);
    // Exactly enough is left to fill the other ten slots at the cheapest base prices.
    expect(bTeam.maxBidM).toBeGreaterThanOrEqual(0);
  });

  it('resets the clock to the anti-snipe time when a bid lands in the last seconds', async () => {
    const s = await startGame(1);
    const [a, b] = s.order as [string, string];
    const player = available(await view(s))[2];
    await nominate(s, a, player);
    t.db.update(games).set({ lotDeadline: Date.now() + 3_000 }).where(eq(games.id, s.gameId)).run();
    const res = await bid(s, b, player.basePriceM + 1);
    expect(res.body.bid.lotDeadline - Date.now()).toBeGreaterThan(9_000);
    expect(res.body.bid.lotDeadline - Date.now()).toBeLessThanOrEqual(10_000);

    // With plenty of time left the deadline does not move.
    t.db.update(games).set({ lotDeadline: Date.now() + 15_000 }).where(eq(games.id, s.gameId)).run();
    const later = await bid(s, a, player.basePriceM + 2);
    expect(later.body.bid.lotDeadline - Date.now()).toBeGreaterThan(14_000);
  });
});

describe('sale', () => {
  it('sells to the leader when the lot clock runs out, in one transaction', async () => {
    const s = await startGame(1);
    const [a, b] = s.order as [string, string];
    const player = available(await view(s))[4];
    await nominate(s, a, player);
    await bid(s, b, player.basePriceM + 3);

    // The clock hit zero but the timer has not run yet: late bids are refused.
    t.db.update(games).set({ lotDeadline: Date.now() - 1 }).where(eq(games.id, s.gameId)).run();
    expect((await bid(s, a, player.basePriceM + 10)).body.error.code).toBe('LOT_CLOSED');
    await t.app.games.auction.tick(s.gameId);

    const v = await view(s);
    const price = player.basePriceM + 3;
    expect(v.phase).toBe('nominating');
    expect(v.lot).toBeNull();
    expect(v.players.find((p: any) => p.id === player.id)).toMatchObject({ status: 'sold', soldTo: b, priceM: price });
    const bTeam = v.teams.find((x: any) => x.participantId === b);
    expect(bTeam.budgetM).toBe(1000 - price);
    expect(bTeam.filled).toBe(1);
    expect(bTeam.slots.some((x: any) => x.playerId === player.id && x.priceM === price)).toBe(true);
    expect(v.sales).toEqual([expect.objectContaining({ sequence: 1, playerId: player.id, participantId: b, priceM: price, autoFilled: false })]);
    expect(v.nominatorId).toBe(b);
    expect(v.nominationDeadline - Date.now()).toBeGreaterThan(25_000);

    const lot = t.db.select().from(lots).where(eq(lots.gameId, s.gameId)).get()!;
    expect(lot).toMatchObject({ status: 'sold', finalPriceM: price, leaderParticipantId: b });
    expect(t.db.select().from(bids).where(eq(bids.lotId, lot.id)).all()).toHaveLength(2);
    expect(t.db.select().from(participants).where(eq(participants.id, b)).get()!.budgetRemainingM).toBe(1000 - price);
  });

  it('ends the auction automatically when every team has 11 players', async () => {
    const s = await startGame(1);
    let guard = 0;
    for (;;) {
      const v = await view(s);
      if (v.phase === 'complete') break;
      await expire(s, v.phase === 'nominating' ? 'nomination' : 'lot');
      if (++guard > 80) throw new Error('auction did not finish');
    }
    const v = await view(s);
    const g = t.db.select().from(games).where(eq(games.id, s.gameId)).get()!;
    expect(g.status).toBe('auction_complete');
    expect(v.bought).toBe(22);
    expect(v.teams.every((x: any) => x.filled === 11 && x.budgetM >= 0)).toBe(true);
    const pool = t.db.select().from(gamePool).where(eq(gamePool.gameId, s.gameId)).all();
    expect(pool.filter((p) => p.status === 'sold')).toHaveLength(22);
    expect(pool.filter((p) => p.status === 'unsold')).toHaveLength(pool.length - 22);
    const expected = 2 * REVEAL_STEP_MS + REVEAL_TAIL_MS + SEASON_COUNTDOWN_MS;
    expect(g.countdownDeadline! - Date.now()).toBeGreaterThan(expected - 2_000);
    expect(auditActions(s.gameId)).toContain('game.auction.complete');

    // The auction is closed to bids and nominations.
    const unsold = pool.find((p) => p.status === 'unsold')!;
    expect((await nominate(s, s.order[0]!, { id: unsold.poolPlayerId, basePriceM: 5 })).body.error.code).toBe('NOT_AUCTIONING');

    // Team Reveal: both XIs, the unsold players and a 20-team league preview.
    const reveal = (await s.host.get(`/api/games/${s.code}/reveal`)).body.reveal;
    expect(reveal.teams).toHaveLength(2);
    expect(reveal.teams.every((x: any) => x.slots.length === 11 && x.grade)).toBe(true);
    expect(reveal.unsold).toHaveLength(pool.length - 22);
    expect(reveal.league).toHaveLength(20);
    expect(reveal.league.filter((r: any) => r.kind === 'human')).toHaveLength(2);

    // The host can hold the season countdown (pause) and let it run again.
    await s.host.post(`/api/games/${s.code}/auction/pause`);
    expect((await view(s)).paused.timer).toBe('countdown');
    await s.host.post(`/api/games/${s.code}/auction/resume`);
    expect(t.db.select().from(games).where(eq(games.id, s.gameId)).get()!.status).toBe('auction_complete');

    await expire(s, 'countdown');
    expect(auditActions(s.gameId)).toContain('game.season.start');
  });
});

describe('pause', () => {
  it('freezes a live lot, rejects actions with PAUSED, survives a restart, and resumes with the time left', async () => {
    const s = await startGame(1);
    const [a, b] = s.order as [string, string];
    const player = available(await view(s))[1];
    await nominate(s, a, player);

    const stranger = s.clients.get(b)!;
    expect((await stranger.post(`/api/games/${s.code}/auction/pause`)).body.error.code).toBe('HOST_ONLY');

    const paused = await s.host.post(`/api/games/${s.code}/auction/pause`);
    expect(paused.status).toBe(200);
    const pv = paused.body.auction.paused;
    expect(pv.timer).toBe('lot');
    expect(pv.byName).toBe('hosty');
    expect(pv.remainingMs).toBeGreaterThan(15_000);
    expect(paused.body.auction.lotDeadline).toBeNull();

    expect((await bid(s, b, player.basePriceM + 1)).body.error.code).toBe('PAUSED');
    expect((await s.host.post(`/api/games/${s.code}/auction/skip`)).body.error.code).toBe('PAUSED');
    await t.app.games.auction.tick(s.gameId);
    expect((await view(s)).lot.playerId).toBe(player.id);

    // A restart keeps the game paused.
    const again = buildApp({ db: t.db, botDelayMs: null, startCountdownMs: 0 });
    await again.ready();
    const res = await again.inject({ method: 'GET', url: `/api/games/${s.code}` });
    expect(JSON.parse(res.body).snapshot.game.status).toBe('paused');
    await again.close();

    const resumed = await s.host.post(`/api/games/${s.code}/auction/resume`);
    const left = resumed.body.auction.lotDeadline - Date.now();
    expect(left).toBeGreaterThan(pv.remainingMs - 2_000);
    expect(left).toBeLessThanOrEqual(pv.remainingMs + 50);
    expect(resumed.body.auction.paused).toBeNull();
    expect((await bid(s, b, player.basePriceM + 1)).status).toBe(200);
    expect(auditActions(s.gameId)).toEqual(expect.arrayContaining(['game.pause', 'game.resume']));
  });

  it('pauses between lots too: nominations and the nomination clock freeze, and the time left comes back', async () => {
    const s = await startGame(1);
    const [a] = s.order as [string, string];
    const player = available(await view(s))[0];
    t.db.update(games).set({ nominationDeadline: Date.now() + 20_000 }).where(eq(games.id, s.gameId)).run();

    const paused = await s.host.post(`/api/games/${s.code}/auction/pause`);
    expect(paused.status).toBe(200);
    const pv = paused.body.auction.paused;
    expect(pv.timer).toBe('nomination');
    expect(pv.remainingMs).toBeGreaterThan(18_000);
    expect(paused.body.auction.nominationDeadline).toBeNull();

    expect((await nominate(s, a, player)).body.error.code).toBe('PAUSED');
    // A timer firing while paused changes nothing: no auto-nomination.
    t.db.update(games).set({ nominationDeadline: Date.now() - 1 }).where(eq(games.id, s.gameId)).run();
    await t.app.games.auction.tick(s.gameId);
    t.db.update(games).set({ nominationDeadline: null }).where(eq(games.id, s.gameId)).run();
    expect((await view(s)).lot).toBeNull();
    await new Promise((r) => setTimeout(r, 300));

    const resumed = await s.host.post(`/api/games/${s.code}/auction/resume`);
    const left = resumed.body.auction.nominationDeadline - Date.now();
    expect(left).toBeGreaterThan(pv.remainingMs - 2_000);
    expect(left).toBeLessThanOrEqual(pv.remainingMs + 50);
    expect((await nominate(s, a, player)).status).toBe(200);
  });

  it('lets an admin pause someone else’s game', async () => {
    const s = await startGame(1);
    const admin = await signUp(t.app, ADMIN_NAME);
    const res = await admin.post(`/api/games/${s.code}/auction/pause`);
    expect(res.status).toBe(200);
    expect(res.body.auction.paused.timer).toBe('nomination');
  });
});

describe('host controls', () => {
  it('skips a nomination and extends the clock', async () => {
    const s = await startGame(1);
    const skipped = await s.host.post(`/api/games/${s.code}/auction/skip`);
    expect(skipped.body.auction.lot.autoNominated).toBe(true);
    expect((await s.host.post(`/api/games/${s.code}/auction/skip`)).body.error.code).toBe('LOT_IN_PROGRESS');
    const before = skipped.body.auction.lotDeadline;
    const extended = await s.host.post(`/api/games/${s.code}/auction/extend`);
    expect(extended.body.auction.lotDeadline).toBe(before + 10_000);
    expect(auditActions(s.gameId)).toEqual(expect.arrayContaining(['game.nomination.skip', 'game.timer.extend']));
  });

  it('undoes the last sale while the next lot has no bids, and refuses once it has', async () => {
    const s = await startGame(1);
    const [a, b] = s.order as [string, string];
    const player = available(await view(s))[6];
    await nominate(s, a, player);
    await bid(s, b, player.basePriceM + 2);
    await expire(s, 'lot');

    // B is on the clock and nominates; with only the opening bid the undo is still allowed.
    const next = available(await view(s))[0];
    await nominate(s, b, next);
    const undone = await s.host.post(`/api/games/${s.code}/auction/undo`);
    expect(undone.status).toBe(200);
    const v = undone.body.auction;
    expect(v.lot).toBeNull();
    expect(v.sales).toHaveLength(0);
    expect(v.nominatorId).toBe(a);
    expect(v.players.find((p: any) => p.id === player.id).status).toBe('available');
    expect(v.players.find((p: any) => p.id === next.id).status).toBe('available');
    expect(v.teams.find((x: any) => x.participantId === b).budgetM).toBe(1000);
    expect(auditActions(s.gameId)).toContain('game.sale.undo');

    // Sell again, then bid on the next lot: now the undo is refused.
    await nominate(s, a, player);
    await expire(s, 'lot');
    await nominate(s, b, next);
    await bid(s, a, next.basePriceM + 1);
    expect((await s.host.post(`/api/games/${s.code}/auction/undo`)).body.error.code).toBe('LOT_IN_PROGRESS');
    expect((await s.clients.get(b)!.post(`/api/games/${s.code}/auction/undo`)).body.error.code).toBe('HOST_ONLY');
  });

  it('ends early by auto-filling every open slot', async () => {
    const s = await startGame(1);
    await s.host.post(`/api/games/${s.code}/auction/skip`);
    const res = await s.host.post(`/api/games/${s.code}/auction/end`);
    expect(res.status).toBe(200);
    const v = res.body.auction;
    expect(v.phase).toBe('complete');
    expect(v.bought).toBe(22);
    expect(v.sales.every((x: any) => x.autoFilled)).toBe(true);
    expect(v.teams.every((x: any) => x.filled === 11 && x.budgetM >= 0)).toBe(true);
    expect(t.db.select().from(lots).where(eq(lots.gameId, s.gameId)).get()!.status).toBe('void');
    expect(auditActions(s.gameId)).toContain('game.auction.end_early');
  });

  it('resets the auction to the first nomination', async () => {
    const s = await startGame(1);
    await s.host.post(`/api/games/${s.code}/auction/skip`);
    await expire(s, 'lot');
    const res = await s.host.post(`/api/games/${s.code}/auction/reset`);
    const v = res.body.auction;
    expect(v.sales).toHaveLength(0);
    expect(v.nominatorId).toBe(s.order[0]);
    expect(v.players.every((p: any) => p.status === 'available')).toBe(true);
    expect(v.teams.every((x: any) => x.budgetM === 1000 && x.filled === 0)).toBe(true);
    expect(t.db.select().from(lots).where(eq(lots.gameId, s.gameId)).all()).toHaveLength(0);
    expect(auditActions(s.gameId)).toContain('game.auction.reset');
  });

  it('hands a disconnected manager’s team to a bot, and back', async () => {
    const s = await startGame(1);
    const [, b] = s.order as [string, string];
    const other = s.clients.get(b)!;
    expect((await other.post(`/api/games/${s.code}/participants/${s.order[0]}/control`, { mode: 'bot' })).body.error.code).toBe('HOST_ONLY');
    const res = await s.host.post(`/api/games/${s.code}/participants/${b}/control`, { mode: 'bot', level: 'hard' });
    expect(res.status).toBe(200);
    const snap = (await s.host.get(`/api/games/${s.code}`)).body.snapshot;
    expect(snap.participants.find((p: any) => p.id === b)).toMatchObject({ control: 'bot', botLevel: 'hard' });

    // The bot now acts for B: after A's lot is sold, it is B's turn and the bot nominates.
    await s.host.post(`/api/games/${s.code}/auction/skip`);
    await expire(s, 'lot');
    expect(await t.app.games.auction.botTick(s.gameId)).toBe(true);
    expect((await view(s)).lot.nominatorId).toBe(b);

    // The manager takes the team back.
    const back = await other.post(`/api/games/${s.code}/participants/${b}/control`, { mode: 'human' });
    expect(back.status).toBe(200);
    expect(t.db.select().from(participants).where(eq(participants.id, b)).get()!.control).toBe('human');
    expect(auditActions(s.gameId).filter((x) => x === 'game.team.control')).toHaveLength(2);
  });
});

describe('refresh and takeover (section 14)', () => {
  it('restores the exact live lot and time left on a refresh or a server restart', async () => {
    const s = await startGame(1);
    const [a, b] = s.order as [string, string];
    const player = available(await view(s))[3];
    await nominate(s, a, player);
    await bid(s, b, player.basePriceM + 2);
    const live = await view(s);
    expect(live.lot).toMatchObject({ playerId: player.id, currentBidM: player.basePriceM + 2, leaderId: b });

    // A refresh is a fresh fetch of the snapshot: same lot, same bids, same deadline.
    const refreshed = (await s.clients.get(b)!.get(`/api/games/${s.code}`)).body.snapshot.auction;
    expect(refreshed.lot).toEqual(live.lot);
    expect(refreshed.lotDeadline).toBe(live.lotDeadline);
    expect(refreshed.teams).toEqual(live.teams);

    // A restarted server reads the same state back and keeps the lot clock.
    const again = buildApp({ db: t.db, botDelayMs: null, startCountdownMs: 0 });
    await again.ready();
    const res = await again.inject({ method: 'GET', url: `/api/games/${s.code}` });
    const restored = JSON.parse(res.body).snapshot.auction;
    expect(restored.lot).toEqual(live.lot);
    expect(restored.lotDeadline).toBe(live.lotDeadline);
    expect(restored.lotDeadline - Date.now()).toBeGreaterThan(10_000);
    await again.close();
  });

  it('can put a team on auto-nominate only: it nominates on its turn but never bids', async () => {
    const s = await startGame(1);
    const [a, b] = s.order as [string, string];
    const res = await s.host.post(`/api/games/${s.code}/participants/${b}/control`, { mode: 'auto' });
    expect(res.status).toBe(200);
    expect((await s.host.get(`/api/games/${s.code}`)).body.snapshot.participants.find((p: any) => p.id === b).control).toBe('auto');

    // On A's lot the auto team does not bid, so A buys at the opening price.
    const player = available(await view(s))[0];
    await nominate(s, a, player);
    expect(await t.app.games.auction.botTick(s.gameId)).toBe(false);
    await expire(s, 'lot');
    const sold = (await view(s)).players.find((p: any) => p.id === player.id);
    expect(sold).toMatchObject({ status: 'sold', soldTo: a, priceM: player.basePriceM });

    // On B's turn the server nominates for it: a legal player at base price.
    expect(await t.app.games.auction.botTick(s.gameId)).toBe(true);
    const v = await view(s);
    expect(v.lot).toMatchObject({ nominatorId: b, autoNominated: true });
    const picked = v.players.find((p: any) => p.id === v.lot.playerId);
    expect(v.lot.currentBidM).toBe(picked.basePriceM);
  });
});

describe('bots', () => {
  it('bid on a live lot and nominate on their turn, following the server rules', async () => {
    const s = await startGame(0, ['easy', 'hard']);
    const [hostId, botA] = s.order as [string, string, string];
    const player = available(await view(s), 'ST')[0];
    await nominate(s, hostId, player);
    expect(await t.app.games.auction.botTick(s.gameId)).toBe(true);
    let v = await view(s);
    expect(v.lot.bids).toHaveLength(2);
    expect(v.lot.bids[1].isBot).toBe(true);
    expect(v.lot.leaderId).not.toBe(hostId);

    // Let the bots bid until they stop, then sell.
    for (let i = 0; i < 200 && (await t.app.games.auction.botTick(s.gameId)); i++);
    await expire(s, 'lot');
    v = await view(s);
    expect(v.nominatorId).toBe(botA);
    expect(await t.app.games.auction.botTick(s.gameId)).toBe(true);
    v = await view(s);
    expect(v.lot.nominatorId).toBe(botA);
    expect(v.lot.autoNominated).toBe(false);
    const botBid = t.db.select().from(bids).where(and(eq(bids.lotId, v.lot.id), eq(bids.participantId, botA))).get()!;
    expect(botBid.isBot).toBe(true);
  });
});

describe('team tools', () => {
  it('keeps a watchlist per team', async () => {
    const s = await startGame(1);
    const [, b] = s.order as [string, string];
    const players = available(await view(s));
    const c = s.clients.get(b)!;
    await c.put(`/api/games/${s.code}/watchlist/${players[0].id}`);
    const res = await c.put(`/api/games/${s.code}/watchlist/${players[1].id}`);
    expect(res.body.playerIds).toEqual([players[0].id, players[1].id]);
    expect((await c.del(`/api/games/${s.code}/watchlist/${players[0].id}`)).body.playerIds).toEqual([players[1].id]);
    expect((await c.put(`/api/games/${s.code}/watchlist/nobody`)).status).toBe(404);
    expect((await s.host.get(`/api/games/${s.code}/watchlist`)).body.playerIds).toEqual([]);
    const stranger = await guest(t.app, 'Stranger');
    expect((await stranger.put(`/api/games/${s.code}/watchlist/${players[0].id}`)).status).toBe(403);
  });

  it('swaps players between slots both can play, and refuses an illegal swap', async () => {
    const s = await startGame(1);
    const [a] = s.order as [string, string];
    const cb = available(await view(s), 'CB')[0];
    await nominate(s, a, cb);
    await expire(s, 'lot');
    let mine = (await view(s)).teams.find((x: any) => x.participantId === a);
    const from = mine.slots.find((x: any) => x.playerId === cb.id);
    const to = mine.slots.find((x: any) => x.type === 'CB' && x.key !== from.key);
    const res = await s.host.post(`/api/games/${s.code}/lineup/swap`, { slotA: from.key, slotB: to.key });
    expect(res.status).toBe(200);
    mine = res.body.auction.teams.find((x: any) => x.participantId === a);
    expect(mine.slots.find((x: any) => x.key === to.key).playerId).toBe(cb.id);
    expect(mine.slots.find((x: any) => x.key === from.key).playerId).toBeNull();
    const gk = mine.slots.find((x: any) => x.type === 'GK');
    expect((await s.host.post(`/api/games/${s.code}/lineup/swap`, { slotA: to.key, slotB: gk.key })).body.error.code).toBe('ILLEGAL_SWAP');
  });
});
