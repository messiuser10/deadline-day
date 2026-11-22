import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { GameSnapshot, LobbyUpdate } from '@deadline-day/protocol';
import { auditLog, clubs, gamePool, games, lineupSlots, participants } from '../src/db/schema';
import { ADMIN_NAME, Client, createGame, guest, signUp, team, testApp, type TestApp } from './helpers';

let t: TestApp;
let host: Client;
let code: string;

beforeEach(async () => {
  t = await testApp();
  host = await signUp(t.app, 'hosty');
  code = await createGame(host);
});
afterEach(() => t.close());

const snapshot = async (c: Client = host): Promise<GameSnapshot> => (await c.get(`/api/games/${code}`)).body.snapshot;

describe('lobby', () => {
  it('creates a game with the host as the first team and a live pool preview', async () => {
    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{6}$/);
    const s = await snapshot();
    expect(s.game).toMatchObject({ code, name: 'Friday Draft', status: 'lobby', countdownDeadline: null });
    expect(s.participants).toHaveLength(1);
    expect(s.participants[0]).toMatchObject({ teamName: 'Host Town', isHost: true, isBot: false, formation: '4-3-3' });
    expect(s.pool.teams).toBe(1);
    expect(s.aiClubs.inLeague).toHaveLength(19);
    expect(s.aiClubs.leftOut.map((c) => c.name)).toEqual(['Inter Miami']);
    expect(s.startBlockers.map((b) => b.code)).toEqual(['TOO_FEW_TEAMS']);
    expect(t.db.select().from(auditLog).where(eq(auditLog.action, 'game.create')).all()).toHaveLength(1);
  });

  it('accepts lowercase codes and 404s unknown ones', async () => {
    expect((await host.get(`/api/games/${code.toLowerCase()}`)).status).toBe(200);
    expect((await host.get('/api/games/ZZZZZZ')).body.error.code).toBe('GAME_NOT_FOUND');
  });

  it('needs a signed-in user to create or join', async () => {
    const anon = new Client(t.app);
    expect((await anon.post('/api/games', { name: 'Nope', team: team('Nope FC') })).status).toBe(401);
    expect((await anon.post(`/api/games/${code}/join`, team('Nope FC'))).status).toBe(401);
  });

  it('lets players join and grows the pool preview and shrinks the AI clubs', async () => {
    const before = await snapshot();
    const p2 = await guest(t.app, 'Guest Two');
    const joined = await p2.post(`/api/games/${code}/join`, team('Second City', { formation: '3-5-2' }));
    expect(joined.status).toBe(201);
    const state: LobbyUpdate = joined.body.state;
    expect(state.participants.map((p) => p.teamName)).toEqual(['Host Town', 'Second City']);
    expect(state.participants[1]).toMatchObject({ isGuest: true, isReady: false, managerName: 'Guest Two' });
    expect(state.pool.totalSize).toBeGreaterThan(before.pool.totalSize);
    expect(state.aiClubs.inLeague).toHaveLength(18);
    expect(state.game.nominationOrder).toEqual(state.participants.map((p) => p.id));
    expect(state.startBlockers.map((b) => b.code)).toEqual(['NOT_READY']);

    expect((await p2.post(`/api/games/${code}/join`, team('Again FC'))).body.error.code).toBe('ALREADY_JOINED');
    const p3 = await guest(t.app, 'Guest Three');
    expect((await p3.post(`/api/games/${code}/join`, team('host town'))).body.error.code).toBe('TEAM_NAME_TAKEN');
  });

  it('changes formation, colour and ready state, and keeps the preview live', async () => {
    const p2 = await guest(t.app, 'Two');
    await p2.post(`/api/games/${code}/join`, team('Second City'));
    const patched = await p2.patch(`/api/games/${code}/team`, { formation: '4-4-2', isReady: true, color: '#3B82F6' });
    expect(patched.status).toBe(200);
    const me = patched.body.state.participants[1];
    expect(me).toMatchObject({ formation: '4-4-2', isReady: true, color: '#3b82f6' });
    expect(patched.body.state.startBlockers).toEqual([]);
    expect((await p2.patch(`/api/games/${code}/team`, { formation: '9-9-9' })).status).toBe(400);
  });

  it('fills to max teams and then refuses', async () => {
    await host.patch(`/api/games/${code}/settings`, { settings: { maxTeams: 2 } });
    await (await guest(t.app, 'Two')).post(`/api/games/${code}/join`, team('Second City'));
    expect((await (await guest(t.app, 'Three')).post(`/api/games/${code}/join`, team('Third Town'))).body.error.code).toBe('GAME_FULL');
    expect((await host.patch(`/api/games/${code}/settings`, { settings: { maxTeams: 2 } })).status).toBe(200);
  });

  it('rejects offensive team names', async () => {
    const p2 = await guest(t.app, 'Two');
    expect((await p2.post(`/api/games/${code}/join`, team('Shit United'))).body.error.code).toBe('PROFANITY');
  });

  it('masks profanity in chat and keeps history in the snapshot', async () => {
    const res = await host.post(`/api/games/${code}/chat`, { body: 'what the   fuck' });
    expect(res.status).toBe(201);
    expect(res.body.message.body).toBe('what the f***');
    expect((await snapshot()).chat.map((m) => m.body)).toEqual(['what the f***']);
    const outsider = await guest(t.app, 'Outsider');
    expect((await outsider.post(`/api/games/${code}/chat`, { body: 'hi' })).body.error.code).toBe('NOT_IN_GAME');
  });
});

describe('host controls', () => {
  it('are host only (403) for other players', async () => {
    const p2 = await guest(t.app, 'Two');
    const joined = await p2.post(`/api/games/${code}/join`, team('Second City'));
    const hostId = joined.body.state.participants[0].id as string;
    const calls = [
      p2.patch(`/api/games/${code}/settings`, { settings: { budgetM: 900 } }),
      p2.post(`/api/games/${code}/bots`, {}),
      p2.del(`/api/games/${code}/participants/${hostId}`),
      p2.put(`/api/games/${code}/order`, { order: [hostId] }),
      p2.post(`/api/games/${code}/order/randomize`),
      p2.post(`/api/games/${code}/host`, { participantId: hostId }),
      p2.post(`/api/games/${code}/start`, { force: true }),
      p2.post(`/api/games/${code}/cancel`),
    ];
    for (const r of await Promise.all(calls)) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('HOST_ONLY');
    }
  });

  it('lets a site admin act as host', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    expect((await admin.patch(`/api/games/${code}/settings`, { settings: { budgetM: 900 } })).status).toBe(200);
  });

  it('validates settings against the limits', async () => {
    const bad = await host.patch(`/api/games/${code}/settings`, { settings: { budgetM: 100 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('SETTING_OUT_OF_RANGE');
    // Forced without a formation takes the host's formation.
    const hostFormation = await host.patch(`/api/games/${code}/settings`, { settings: { formationRule: 'forced' } });
    expect(hostFormation.body.state.game.settings).toMatchObject({ formationRule: 'forced', forcedFormation: '4-3-3' });
    expect((await host.patch(`/api/games/${code}/settings`, { settings: { forcedFormation: '9-9-9' } })).status).toBe(400);
    const forced = await host.patch(`/api/games/${code}/settings`, { settings: { formationRule: 'forced', forcedFormation: '4-4-2' } });
    expect(forced.body.state.participants[0].formation).toBe('4-4-2');
    expect((await host.patch(`/api/games/${code}/team`, { formation: '4-3-3' })).body.error.code).toBe('FORMATION_FORCED');
    const budget = await host.patch(`/api/games/${code}/settings`, { settings: { budgetM: 750 } });
    expect(budget.body.state.participants[0].budgetRemainingM).toBe(750);
  });

  it('adds, edits and removes bots', async () => {
    const add = await host.post(`/api/games/${code}/bots`, { level: 'hard', formation: '3-5-2' });
    expect(add.status).toBe(201);
    const bot = add.body.state.participants.find((p: { id: string }) => p.id === add.body.participantId);
    expect(bot).toMatchObject({ isBot: true, botLevel: 'hard', formation: '3-5-2', isReady: true, managerName: 'Bot (Hard)' });
    expect(bot.color).not.toBe(add.body.state.participants[0].color);

    const edit = await host.patch(`/api/games/${code}/participants/${bot.id}`, { level: 'easy' });
    expect(edit.body.state.participants[1].botLevel).toBe('easy');
    const removed = await host.del(`/api/games/${code}/participants/${bot.id}`);
    expect(removed.body.state.participants).toHaveLength(1);

    await host.patch(`/api/games/${code}/settings`, { settings: { botsAllowed: false } });
    expect((await host.post(`/api/games/${code}/bots`, {})).body.error.code).toBe('BOTS_OFF');
  });

  it('kicks a player, who can see the game but is no longer in it', async () => {
    const p2 = await guest(t.app, 'Two');
    const joined = await p2.post(`/api/games/${code}/join`, team('Second City'));
    const hostId = joined.body.state.participants[0].id;
    expect((await host.del(`/api/games/${code}/participants/${hostId}`)).body.error.code).toBe('CANNOT_KICK_HOST');
    const kicked = await host.del(`/api/games/${code}/participants/${joined.body.participantId}`);
    expect(kicked.body.state.participants).toHaveLength(1);
    expect(kicked.body.state.game.nominationOrder).toEqual([hostId]);
    expect((await p2.patch(`/api/games/${code}/team`, { isReady: true })).body.error.code).toBe('NOT_IN_GAME');
  });

  it('sets and randomizes the nomination order, and rejects a bad one', async () => {
    const a = (await host.post(`/api/games/${code}/bots`, {})).body.participantId as string;
    const b = (await host.post(`/api/games/${code}/bots`, {})).body.participantId as string;
    const hostId = (await snapshot()).participants[0]!.id;
    const set = await host.put(`/api/games/${code}/order`, { order: [b, hostId, a] });
    expect(set.body.state.game.nominationOrder).toEqual([b, hostId, a]);
    expect((await host.put(`/api/games/${code}/order`, { order: [b, a] })).body.error.code).toBe('BAD_ORDER');
    const shuffled = await host.post(`/api/games/${code}/order/randomize`);
    expect([...shuffled.body.state.game.nominationOrder].sort()).toEqual([a, b, hostId].sort());
  });

  it('passes host on when the host leaves, and cancels a game nobody is left in', async () => {
    const p2 = await guest(t.app, 'Two');
    await p2.post(`/api/games/${code}/join`, team('Second City'));
    await host.post(`/api/games/${code}/leave`);
    const s = await snapshot(p2);
    expect(s.participants).toHaveLength(1);
    expect(s.participants[0]).toMatchObject({ teamName: 'Second City', isHost: true });
    await p2.post(`/api/games/${code}/leave`);
    expect((await snapshot(p2)).game.status).toBe('cancelled');
  });

  it('transfers host to another human but not to a bot', async () => {
    const p2 = await guest(t.app, 'Two');
    const pid = (await p2.post(`/api/games/${code}/join`, team('Second City'))).body.participantId;
    const bot = (await host.post(`/api/games/${code}/bots`, {})).body.participantId;
    expect((await host.post(`/api/games/${code}/host`, { participantId: bot })).body.error.code).toBe('BOT_CANNOT_HOST');
    const moved = await host.post(`/api/games/${code}/host`, { participantId: pid });
    expect(moved.body.state.participants.find((p: { id: string }) => p.id === pid).isHost).toBe(true);
    expect((await host.post(`/api/games/${code}/cancel`)).status).toBe(403);
  });

  it('lists public lobbies only', async () => {
    expect((await host.get('/api/games/public')).body.lobbies).toEqual([]);
    await host.patch(`/api/games/${code}/settings`, { settings: { visibility: 'public' } });
    expect((await host.get('/api/games/public')).body.lobbies).toEqual([
      expect.objectContaining({ code, name: 'Friday Draft', hostName: 'hosty', teams: 1, maxTeams: expect.any(Number) }),
    ]);
  });
});

describe('starting the auction', () => {
  it('blocks start until everyone is ready, unless forced', async () => {
    const p2 = await guest(t.app, 'Two');
    await p2.post(`/api/games/${code}/join`, team('Second City'));
    const blocked = await host.post(`/api/games/${code}/start`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('START_BLOCKED');
    expect(blocked.body.error.details[0]).toMatchObject({ code: 'NOT_READY', forceable: true });

    const forced = await host.post(`/api/games/${code}/start`, { force: true });
    expect(forced.status).toBe(202);
    expect(forced.body.state.game.status).toBe('auctioning');
  });

  it('cannot start alone, even when forced', async () => {
    expect((await host.post(`/api/games/${code}/start`, { force: true })).body.error.details[0].code).toBe('TOO_FEW_TEAMS');
  });

  it('builds the pool, budgets, slots, AI clubs and strength snapshot, then locks the lobby', async () => {
    await host.patch(`/api/games/${code}/settings`, { settings: { budgetM: 800 } });
    await host.post(`/api/games/${code}/bots`, { formation: '3-5-2' });
    const p3 = await guest(t.app, 'Three');
    await p3.post(`/api/games/${code}/join`, team('Third Town', { formation: '4-4-2' }));
    await p3.patch(`/api/games/${code}/team`, { isReady: true });
    const lobby = await snapshot();

    const res = await host.post(`/api/games/${code}/start`, {});
    expect(res.status).toBe(202);
    expect(res.body.countdownDeadline).toBeNull();
    const state: LobbyUpdate = res.body.state;
    expect(state.game.status).toBe('auctioning');

    const game = t.db.select().from(games).where(eq(games.joinCode, code)).get()!;
    expect(game.seed).toEqual(expect.any(Number));
    expect(game.nominationOrder).toEqual(lobby.game.nominationOrder);

    const pool = t.db.select().from(gamePool).where(eq(gamePool.gameId, game.id)).all();
    expect(pool).toHaveLength(lobby.pool.totalSize);
    expect(pool.length).toBeGreaterThanOrEqual(lobby.pool.totalNeed);
    expect(new Set(pool.map((p) => p.poolPlayerId)).size).toBe(pool.length);
    expect(pool.every((p) => p.status === 'available')).toBe(true);
    expect(pool[0]!.snapshot).toEqual(expect.objectContaining({ name: expect.any(String), overall: expect.any(Number), clubNow: expect.anything() }));

    const teams = t.db.select().from(participants).where(eq(participants.gameId, game.id)).all();
    expect(teams.map((p) => p.budgetRemainingM)).toEqual([800, 800, 800]);
    for (const p of teams) {
      expect(t.db.select().from(lineupSlots).where(eq(lineupSlots.participantId, p.id)).all()).toHaveLength(11);
    }

    expect(game.aiClubIds).toHaveLength(17);
    expect(state.aiClubs.inLeague).toHaveLength(17);
    expect(state.aiClubs.leftOut.map((c) => c.name)).toEqual(['Brighton and Hove Albion', 'Al-Nassr', 'Inter Miami']);
    const snap = game.strengthSnapshot as { clubs: { name: string; rank: number; strength: number }[] };
    expect(snap.clubs.slice(0, 5).map((c) => c.name)).toEqual(['Paris Saint-Germain', 'Real Madrid', 'Bayern Munich', 'FC Barcelona', 'Arsenal']);
    expect(snap.clubs[0]).toMatchObject({ rank: 1, strength: 88.93 });
    expect(t.db.select().from(clubs).where(eq(clubs.id, 'paris-saint-germain')).get()?.strengthRating).toBeCloseTo(88.93, 2);

    expect((await p3.patch(`/api/games/${code}/team`, { formation: '3-5-2' })).body.error.code).toBe('NOT_IN_LOBBY');
    expect((await host.post(`/api/games/${code}/bots`, {})).body.error.code).toBe('NOT_IN_LOBBY');
    expect((await (await guest(t.app, 'Late')).post(`/api/games/${code}/join`, team('Late FC'))).status).toBe(409);
    expect((await host.post(`/api/games/${code}/start`, {})).body.error.code).toBe('NOT_IN_LOBBY');
    expect((await snapshot()).pool).toEqual(state.pool);
  });

  it('runs a countdown when configured and starts when it ends', async () => {
    const slow = await testApp({ startCountdownMs: 50 });
    try {
      const h = await signUp(slow.app, 'hosty');
      const c = await createGame(h);
      await h.post(`/api/games/${c}/bots`, {});
      const res = await h.post(`/api/games/${c}/start`, {});
      expect(res.body.countdownDeadline).toBeGreaterThan(Date.now());
      expect(res.body.state.game.countdownDeadline).toBe(res.body.countdownDeadline);
      expect((await h.post(`/api/games/${c}/bots`, {})).body.error.code).toBe('COUNTDOWN_RUNNING');
      await new Promise((r) => setTimeout(r, 120));
      const after = (await h.get(`/api/games/${c}`)).body.snapshot as GameSnapshot;
      expect(after.game).toMatchObject({ status: 'auctioning', countdownDeadline: null });
    } finally {
      await slow.close();
    }
  });
});

describe('solo game', () => {
  it('creates a game with the player and three bots of each level', async () => {
    const solo = await host.post('/api/games/solo', { team: team('Lone Wolves') });
    expect(solo.status).toBe(201);
    const s = (await host.get(`/api/games/${solo.body.code}`)).body.snapshot as GameSnapshot;
    expect(s.participants.map((p) => p.botLevel)).toEqual([null, 'easy', 'medium', 'hard']);
    expect(s.startBlockers).toEqual([]);
  });
});
