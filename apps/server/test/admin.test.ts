/* eslint-disable @typescript-eslint/no-explicit-any -- test responses are loosely typed JSON */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { prices } from '@deadline-day/engine';
import { appSettings, auditLog, chatMessages, gameResults, games, participants, poolPlayers, standingRows, users } from '../src/db/schema';
import { ADMIN_NAME, Client, createGame, guest, signUp, team, testApp, type TestApp } from './helpers';

let t: TestApp;

beforeEach(async () => {
  t = await testApp({ botDelayMs: null, monteCarloRuns: 20 });
});

afterEach(async () => {
  await t.close();
});

const auditCount = (action?: string) =>
  (action ? t.db.select().from(auditLog).where(eq(auditLog.action, action)) : t.db.select().from(auditLog)).all().length;

/** GET a download with the client's cookie; answers the raw text. */
async function download(c: Client, url: string) {
  const res = await t.app.inject({ method: 'GET', url, headers: c.cookie ? { cookie: c.cookie } : {} });
  return { status: res.statusCode, headers: res.headers, text: res.body };
}

const userId = async (c: Client) => (await c.get('/api/auth/me')).body.user.id as string;

describe('admin role checks', () => {
  it('refuses every admin endpoint to anonymous visitors, users and guests, and changes nothing', async () => {
    const routes = t.app.adminRoutes;
    expect(routes.length).toBeGreaterThanOrEqual(33);
    const admin = await signUp(t.app, ADMIN_NAME);
    const user = await signUp(t.app, 'player1');
    const visitor = await guest(t.app, 'Gus');
    const anon = new Client(t.app);
    const before = { audit: auditCount(), pool: t.db.select().from(poolPlayers).all().length, users: t.db.select().from(users).all().length };

    for (const r of routes) {
      const url = r.url.replace(':id', 'some-id').replace(':code', 'ABCDEF').replace(':playerId', 'some-player');
      const body = r.method === 'GET' || r.method === 'DELETE' ? undefined : { confirm: 'x', key: 'league_name', value: 'Hacked', ids: ['a-b'], action: 'delete' };
      const label = `${r.method} ${r.url}`;
      expect((await anon.req(r.method, url, body)).status, label).toBe(401);
      const asUser = await user.req(r.method, url, body);
      expect(asUser.status, label).toBe(403);
      expect(asUser.body.error.code, label).toBe('ADMIN_ONLY');
      expect((await visitor.req(r.method, url, body)).status, label).toBe(403);
    }

    expect(auditCount()).toBe(before.audit);
    expect(t.db.select().from(poolPlayers).all()).toHaveLength(before.pool);
    expect(t.db.select().from(users).all()).toHaveLength(before.users);
    expect((await admin.get('/api/settings/public')).body.leagueName).not.toBe('Hacked');
    // The same routes work for an admin.
    expect((await admin.get('/api/admin/overview')).status).toBe(200);
  });

  it('refuses a user whose admin role was removed, straight away', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const other = await signUp(t.app, 'deputy');
    const id = await userId(other);
    expect((await admin.patch(`/api/admin/users/${id}`, { role: 'admin' })).status).toBe(200);
    expect((await other.get('/api/admin/overview')).status).toBe(200);
    expect((await admin.patch(`/api/admin/users/${id}`, { role: 'user' })).status).toBe(200);
    expect((await other.get('/api/admin/overview')).status).toBe(403);
  });
});

describe('admin overview', () => {
  it('counts users, games and pool players and lists recent activity', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    await guest(t.app, 'Gus');
    await createGame(admin, 'Lobby One');
    await admin.put('/api/admin/settings', { key: 'maintenance_banner', value: { message: 'Back soon' } });
    const res = await admin.get('/api/admin/overview');
    expect(res.status).toBe(200);
    const o = res.body.overview;
    expect(o.counts).toMatchObject({ users: 2, registered: 1, guests: 1, admins: 1, activeLobbies: 1, auctionsInProgress: 0 });
    expect(o.counts.poolPlayers).toBeGreaterThan(300);
    expect(o.recent[0].action).toBe('admin.announcement.set');
    expect(o.health.map((h: any) => h.code)).toContain('BANNER_ON');
  });
});

describe('admin pool players', () => {
  it('adds, edits, deactivates and deletes players, keeping prices on the curve', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const curve = (await admin.get('/api/admin/settings')).body.settings.price_curve;
    const add = await admin.post('/api/admin/pool', {
      id: 'test-player-st',
      name: 'Test  Player',
      position: 'ST',
      altPositions: ['RW'],
      altSource: 'rule',
      overall: 84,
      seedClub: null,
      clubNow: 'Nowhere FC',
      nationality: 'England',
      isActive: true,
    });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body.player).toMatchObject({ name: 'Test Player', ...prices(84, curve) });
    expect((await admin.post('/api/admin/pool', { ...add.body.player, altSource: 'rule' })).body.error.code).toBe('DUPLICATE_ID');

    const edit = await admin.patch('/api/admin/pool/test-player-st', { overall: 91 });
    expect(edit.body.player).toMatchObject({ overall: 91, ...prices(91, curve) });
    const sts = t.db.select().from(poolPlayers).where(eq(poolPlayers.position, 'ST')).all();
    const above = sts.filter((p) => p.overall > 91).length;
    const level = sts.filter((p) => p.overall === 91).length;
    expect(edit.body.player.positionRank).toBeGreaterThan(above);
    expect(edit.body.player.positionRank).toBeLessThanOrEqual(above + level);

    expect((await admin.patch('/api/admin/pool/test-player-st', { altPositions: ['ST'] })).body.error.code).toBe('ALT_IS_MAIN');
    const bulk = await admin.post('/api/admin/pool/bulk', { action: 'deactivate', ids: ['test-player-st'] });
    expect(bulk.body.changed).toBe(1);
    expect(t.db.select().from(poolPlayers).where(eq(poolPlayers.id, 'test-player-st')).get()!.isActive).toBe(false);

    expect((await admin.del('/api/admin/pool/test-player-st')).status).toBe(204);
    expect(t.db.select().from(poolPlayers).where(eq(poolPlayers.id, 'test-player-st')).get()).toBeUndefined();
    expect(auditCount('admin.pool.create')).toBe(1);
    expect(auditCount('admin.pool.update')).toBe(1);
    expect(auditCount('admin.pool.delete')).toBe(1);
  });

  it('will not delete a player who is in a game pool', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const code = await createGame(admin);
    await admin.post(`/api/games/${code}/bots`, { level: 'easy', formation: '4-4-2' });
    expect((await admin.post(`/api/games/${code}/start`, { force: true })).status).toBe(202);
    const inPool = (await admin.get('/api/admin/pool')).body.pool.players.find((p: any) => p.games > 0);
    expect(inPool).toBeTruthy();
    expect((await admin.del(`/api/admin/pool/${inPool.id}`)).body.error.code).toBe('PLAYER_IN_USE');
  });

  it('exports CSV and JSON, and an unchanged export imports as no changes', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const csv = await download(admin, '/api/admin/pool/export?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="auction-players-.*\.csv"/);
    const lines = csv.text.trim().split(/\r\n/);
    expect(lines[0]).toBe('id,name,position,alt_positions,alt_source,overall,position_rank,market_value_m,base_price_m,seed_club,club_now,nationality,is_active');
    const total = t.db.select().from(poolPlayers).all().length;
    expect(lines).toHaveLength(total + 1);

    const json = await download(admin, '/api/admin/pool/export?format=json');
    expect(JSON.parse(json.text).players).toHaveLength(total);

    const same = await admin.post('/api/admin/pool/import/preview', { format: 'csv', mode: 'upsert', content: csv.text });
    expect(same.status).toBe(200);
    expect(same.body.preview).toMatchObject({ rows: total, added: [], changed: [], deactivated: [], unchanged: total, errors: [] });

    const sameJson = await admin.post('/api/admin/pool/import/preview', { format: 'json', mode: 'upsert', content: json.text });
    expect(sameJson.body.preview).toMatchObject({ added: [], changed: [], errors: [] });
  });

  it('previews an import as a diff and applies it, recomputing prices', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const csv = (await download(admin, '/api/admin/pool/export?format=csv')).text;
    const [header, first, ...rest] = csv.trim().split(/\r\n/);
    const cols = header!.split(',');
    const cells = first!.split(',');
    const id = cells[0]!;
    const overallAt = cols.indexOf('overall');
    const oldOverall = Number(cells[overallAt]);
    cells[overallAt] = String(oldOverall === 99 ? 98 : oldOverall + 1);
    const added = ['brand-new-gk', 'Brand New', 'GK', '', 'rule', '70', '', '', '', '', '', 'Wales', 'true'].join(',');
    const content = [header, cells.join(','), ...rest, added].join('\r\n');

    const preview = await admin.post('/api/admin/pool/import/preview', { format: 'csv', mode: 'upsert', content });
    expect(preview.body.preview.errors.join('\n')).toBe('');
    expect(preview.body.preview.added).toEqual([{ id: 'brand-new-gk', name: 'Brand New', position: 'GK', overall: 70 }]);
    expect(preview.body.preview.changed).toHaveLength(1);
    expect(preview.body.preview.changed[0].id).toBe(id);
    expect(preview.body.preview.changed[0].changes.map((c: any) => c.field)).toContain('overall');
    expect(t.db.select().from(poolPlayers).where(eq(poolPlayers.id, 'brand-new-gk')).get()).toBeUndefined();

    const apply = await admin.post('/api/admin/pool/import/apply', { format: 'csv', mode: 'upsert', content });
    expect(apply.status).toBe(200);
    const curve = (await admin.get('/api/admin/settings')).body.settings.price_curve;
    const row = t.db.select().from(poolPlayers).where(eq(poolPlayers.id, 'brand-new-gk')).get()!;
    expect(row).toMatchObject({ overall: 70, ...prices(70, curve), isActive: true });
    expect(auditCount('admin.pool.import')).toBe(1);

    const bad = await admin.post('/api/admin/pool/import/apply', { format: 'csv', mode: 'upsert', content: `${header}\r\nx-y,Bad,QQ,,rule,200,,,,,,,true` });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('IMPORT_INVALID');
  });

  it('replace mode deactivates players missing from the file', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const csv = (await download(admin, '/api/admin/pool/export?format=csv')).text;
    const lines = csv.trim().split(/\r\n/);
    const dropped = lines.at(-1)!.split(',')[0]!;
    const content = lines.slice(0, -1).join('\r\n');
    const preview = await admin.post('/api/admin/pool/import/preview', { format: 'csv', mode: 'replace', content });
    expect(preview.body.preview.deactivated.map((d: any) => d.id)).toEqual([dropped]);
    await admin.post('/api/admin/pool/import/apply', { format: 'csv', mode: 'replace', content });
    expect(t.db.select().from(poolPlayers).where(eq(poolPlayers.id, dropped)).get()!.isActive).toBe(false);
  });

  it('previews and applies a new price curve to every player', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const params = { anchor: 80, growth: 1.08, baseFraction: 0.4 };
    const preview = await admin.post('/api/admin/pool/reprice/preview', params);
    expect(preview.status).toBe(200);
    expect(preview.body.preview.changedPlayers).toBeGreaterThan(100);
    expect(preview.body.preview.curve.find((c: any) => c.overall === 80)).toMatchObject({ marketValueM: 80, basePriceM: 32 });
    expect(t.db.select().from(appSettings).where(eq(appSettings.key, 'price_curve')).get()!.value).not.toEqual(params);

    await admin.post('/api/admin/pool/reprice/apply', params);
    expect(t.db.select().from(appSettings).where(eq(appSettings.key, 'price_curve')).get()!.value).toEqual(params);
    for (const p of t.db.select().from(poolPlayers).all()) expect({ m: p.marketValueM, b: p.basePriceM }).toEqual({ m: prices(p.overall, params).marketValueM, b: prices(p.overall, params).basePriceM });
    expect((await admin.get('/api/admin/overview')).body.overview.health.map((h: any) => h.code)).not.toContain('PRICE_MISMATCH');
    expect((await admin.post('/api/admin/pool/reprice/preview', { anchor: 80, growth: 3, baseFraction: 0.4 })).status).toBe(400);
  });
});

describe('admin clubs and squads', () => {
  it('a strength override moves a club up the ranking that picks the AI teams', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const list = (await admin.get('/api/admin/clubs')).body.clubs;
    expect(list).toHaveLength(20);
    const weakest = list.at(-1);
    expect(weakest.rank).toBe(20);
    const res = await admin.patch(`/api/admin/clubs/${weakest.id}`, { strengthOverride: 100, primaryColor: '#123456', monogram: 'WKS' });
    expect(res.status).toBe(200);
    expect(res.body.club).toMatchObject({ rank: 1, override: 100, strength: 100, primaryColor: '#123456', monogram: 'WKS' });
    const again = (await admin.get('/api/admin/clubs')).body.clubs;
    expect(again[0].id).toBe(weakest.id);
    await admin.patch(`/api/admin/clubs/${weakest.id}`, { strengthOverride: null });
    expect((await admin.get('/api/admin/clubs')).body.clubs.at(-1).id).toBe(weakest.id);
    expect((await admin.patch(`/api/admin/clubs/${weakest.id}`, { primaryColor: 'red' })).status).toBe(400);
    expect(auditCount('admin.club.update')).toBe(2);
  });

  it('edits an AI squad', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const club = (await admin.get('/api/admin/clubs')).body.clubs[0];
    const squad = (await admin.get(`/api/admin/clubs/${club.id}/squad`)).body.squad;
    const add = await admin.post(`/api/admin/clubs/${club.id}/squad`, { name: 'New Signing', position: 'CM', altPositions: ['CDM', 'CM'], overall: 75, nationality: null });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body.squad).toHaveLength(squad.length + 1);
    const signing = add.body.squad.find((p: any) => p.name === 'New Signing');
    expect(signing.altPositions).toEqual(['CDM']);
    const upd = await admin.put(`/api/admin/clubs/${club.id}/squad/${signing.id}`, { name: 'New Signing', position: 'CAM', altPositions: [], overall: 80, nationality: 'Spain' });
    expect(upd.body.squad.find((p: any) => p.id === signing.id)).toMatchObject({ position: 'CAM', overall: 80, nationality: 'Spain' });
    expect((await admin.del(`/api/admin/clubs/${club.id}/squad/${signing.id}`)).body.squad).toHaveLength(squad.length);
    expect((await admin.del(`/api/admin/clubs/${club.id}/squad/nobody`)).status).toBe(404);
    expect(auditCount('admin.squad.add') + auditCount('admin.squad.update') + auditCount('admin.squad.delete')).toBe(3);
  });
});

describe('admin settings and announcements', () => {
  it('saves valid settings and refuses ones that clash with the others', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    expect((await admin.put('/api/admin/settings', { key: 'league_name', value: '  Friday   League ' })).body.settings.league_name).toBe('Friday League');
    expect((await admin.get('/api/settings/public')).body.leagueName).toBe('Friday League');

    const view = (await admin.get('/api/admin/settings')).body;
    const limits = { ...view.settings.game_limits, budgetM: [2000, 5000] };
    const clash = await admin.put('/api/admin/settings', { key: 'game_limits', value: limits });
    expect(clash.status).toBe(400);
    expect(clash.body.error.code).toBe('SETTINGS_CONFLICT');

    const defaults = { ...view.settings.game_defaults, extraMin: 5, extraPct: 0.3, removeBoughtFromAi: false };
    expect((await admin.put('/api/admin/settings', { key: 'game_defaults', value: defaults })).status).toBe(200);
    const s = (await admin.get('/api/admin/settings')).body.settings;
    expect(s.pool_params).toEqual({ extraMin: 5, extraPct: 0.3 });
    expect(s.remove_bought_from_ai).toBe(false);
    expect((await admin.put('/api/admin/settings', { key: 'game_defaults', value: { ...defaults, budgetM: 10 } })).body.error.code).toBe('SETTING_OUT_OF_RANGE');

    const bands = [
      { from: 1, to: 4, label: 'Top', tone: 'gold', enabled: true },
      { from: 3, to: 6, label: 'Europe', tone: 'blue', enabled: true },
    ];
    expect((await admin.put('/api/admin/settings', { key: 'table_bands', value: bands })).body.error.code).toBe('BANDS_OVERLAP');
    bands[1]!.enabled = false;
    expect((await admin.put('/api/admin/settings', { key: 'table_bands', value: bands })).status).toBe(200);

    expect((await admin.put('/api/admin/settings', { key: 'ai_club_selection', value: { method: 'manual', manualClubIds: ['not-a-club'] } })).body.error.code).toBe('CLUB_NOT_FOUND');
    expect((await admin.put('/api/admin/settings', { key: 'formations_enabled', value: [] })).status).toBe(400);
    expect((await admin.put('/api/admin/settings', { key: 'price_curve', value: { anchor: 1 } })).status).toBe(400);
    expect(auditCount('admin.settings.update')).toBe(3);
  });

  it('sets and clears the site banner', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    await admin.put('/api/admin/settings', { key: 'maintenance_banner', value: { message: 'Maintenance at 6pm' } });
    expect((await new Client(t.app).get('/api/settings/public')).body.maintenanceBanner).toBe('Maintenance at 6pm');
    await admin.put('/api/admin/settings', { key: 'maintenance_banner', value: { message: '   ' } });
    expect((await new Client(t.app).get('/api/settings/public')).body.maintenanceBanner).toBeNull();
    expect(auditCount('admin.announcement.set')).toBe(1);
    expect(auditCount('admin.announcement.clear')).toBe(1);
  });

  it('closing registrations stops new accounts', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    await admin.put('/api/admin/settings', { key: 'registrations_open', value: false });
    const res = await new Client(t.app).post('/api/auth/register', { username: 'latecomer', password: 'password123' });
    expect(res.status).toBe(403);
  });
});

describe('admin games', () => {
  async function auctionGame() {
    const admin = await signUp(t.app, ADMIN_NAME);
    const host = await signUp(t.app, 'hosty');
    const code = await createGame(host, 'Someone Else');
    const p2 = await guest(t.app, 'Pat');
    await p2.post(`/api/games/${code}/join`, team('Pat FC'));
    await host.post(`/api/games/${code}/bots`, { level: 'easy', formation: '4-4-2' });
    return { admin, host, p2, code };
  }

  it('lists and shows every game, and acts as host on games it does not own', async () => {
    const { admin, host, code } = await auctionGame();
    const list = await admin.get('/api/admin/games?status=active');
    expect(list.body.games.map((g: any) => g.code)).toEqual([code]);
    expect(list.body.games[0]).toMatchObject({ teams: 3, humans: 2, bots: 1, host: { username: 'hosty' }, status: 'lobby' });
    expect((await admin.get('/api/admin/games?status=completed')).body.games).toEqual([]);
    expect((await admin.get(`/api/admin/games?q=someone`)).body.games).toHaveLength(1);

    const detail = (await admin.get(`/api/admin/games/${code}`)).body.detail;
    expect(detail.teams).toHaveLength(3);
    const reversed = [...detail.order].reverse();
    expect((await admin.put(`/api/admin/games/${code}/order`, { order: reversed })).body.detail.order).toEqual(reversed);

    expect((await admin.post(`/api/admin/games/${code}/seed`, { seed: 5 })).body.error.code).toBe('NOT_STARTED');
    expect((await admin.post(`/api/games/${code}/start`, { force: true })).status).toBe(202);
    expect((await admin.post(`/api/games/${code}/auction/pause`)).status).toBe(200);
    expect((await host.get(`/api/games/${code}`)).body.snapshot.game.status).toBe('paused');
    expect(auditCount('game.pause')).toBe(1);
  });

  it('reorders a running auction without moving the turn, and changes the seed after the start', async () => {
    const { admin, code } = await auctionGame();
    await admin.post(`/api/games/${code}/start`, { force: true });
    const detail = (await admin.get(`/api/admin/games/${code}`)).body.detail;
    expect(detail.onTheClock).toBeTruthy();
    const others = detail.order.filter((id: string) => id !== detail.onTheClock);
    const order = [others[1], detail.onTheClock, others[0]];
    const res = await admin.put(`/api/admin/games/${code}/order`, { order });
    expect(res.status).toBe(200);
    expect(res.body.detail.order).toEqual(order);
    expect(res.body.detail.onTheClock).toBe(detail.onTheClock);
    expect((await admin.put(`/api/admin/games/${code}/order`, { order: order.slice(1) })).status).toBe(400);
    expect(auditCount('admin.game.order')).toBe(1);

    const seed = await admin.post(`/api/admin/games/${code}/seed`, { seed: 4242 });
    expect(seed.body.seed).toBe(4242);
    expect(t.db.select().from(games).where(eq(games.joinCode, code)).get()!.seed).toBe(4242);
    expect((await admin.post(`/api/admin/games/${code}/seed`, {})).body.seed).not.toBe(4242);
  });

  it('replaces a connected manager with a bot', async () => {
    const { admin, code } = await auctionGame();
    await admin.post(`/api/games/${code}/start`, { force: true });
    const detail = (await admin.get(`/api/admin/games/${code}`)).body.detail;
    const pat = detail.teams.find((x: any) => x.teamName === 'Pat FC');
    const res = await admin.post(`/api/games/${code}/participants/${pat.id}/control`, { mode: 'bot' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await admin.get(`/api/admin/games/${code}`)).body.detail.teams.find((x: any) => x.id === pat.id).control).toBe('bot');
  });

  it('deletes a game and everything in it', async () => {
    const { admin, code } = await auctionGame();
    await admin.post(`/api/games/${code}/start`, { force: true });
    const gameId = t.db.select().from(games).where(eq(games.joinCode, code)).get()!.id;
    expect((await admin.del(`/api/admin/games/${code}`)).status).toBe(204);
    expect(t.db.select().from(games).where(eq(games.id, gameId)).get()).toBeUndefined();
    expect(t.db.select().from(participants).where(eq(participants.gameId, gameId)).all()).toEqual([]);
    const entry = t.db.select().from(auditLog).where(eq(auditLog.action, 'admin.game.delete')).get()!;
    expect(entry.target).toBe(code);
    expect((await admin.get(`/api/games/${code}`)).status).toBe(404);
    const filtered = (await admin.get(`/api/admin/audit?game=${code}`)).body.entries;
    expect(filtered.map((e: any) => e.action)).toContain('admin.game.delete');
  });
});

describe('admin simulation lab', () => {
  it('runs one season or many for any 20 clubs', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const teams = (await admin.get('/api/admin/lab/teams')).body.teams;
    expect(teams).toHaveLength(20);
    const ids = teams.map((x: any) => x.id);

    const one = await admin.post('/api/admin/lab/run', { teamIds: ids, seed: 7, runs: 1 });
    expect(one.status).toBe(200);
    const r = one.body.result;
    expect(r.teams).toHaveLength(20);
    expect(r.teams.map((x: any) => x.last.position)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(r.goals.bins.reduce((s: number, b: any) => s + b.count, 0)).toBe(380);
    expect(r.homeWinRate + r.drawRate + r.awayWinRate).toBeCloseTo(1, 3);
    expect((await admin.post('/api/admin/lab/run', { teamIds: ids, seed: 7, runs: 1 })).body.result.teams).toEqual(r.teams);

    const many = (await admin.post('/api/admin/lab/run', { teamIds: ids, seed: 7, runs: 40, params: { homeAdvantage: 1.3 } })).body.result;
    expect(many.runs).toBe(40);
    expect(many.params.homeAdvantage).toBe(1.3);
    expect(many.teams.reduce((s: number, x: any) => s + x.titleChance, 0)).toBeCloseTo(1, 3);
    expect(many.pointsSpread.bins.reduce((s: number, b: any) => s + b.count, 0)).toBe(40);

    expect((await admin.post('/api/admin/lab/run', { teamIds: ids.slice(0, 19), seed: 7 })).status).toBe(400);
    expect((await admin.post('/api/admin/lab/run', { teamIds: [...ids.slice(0, 19), 'club:nope'], seed: 7 })).body.error.code).toBe('UNKNOWN_TEAM');
  });

  it('runs a one-click test auction, and the lab reproduces its season from the stored seed', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const res = await admin.post('/api/admin/lab/test-auction', { teams: 4, botLevel: 'mixed' });
    expect(res.status).toBe(200);
    const r = res.body.result;
    expect(r.teams).toBe(4);
    expect(r.poolSize).toBeGreaterThan(44);
    expect(r.totalSpentM).toBeGreaterThan(0);
    expect(r.biggest.priceM).toBeGreaterThanOrEqual(r.smallest.priceM);
    expect(r.championName).toBeTruthy();
    const game = t.db.select().from(games).where(eq(games.joinCode, r.code)).get()!;
    expect(game).toMatchObject({ isTest: true, status: 'completed' });
    expect(t.db.select().from(gameResults).where(eq(gameResults.gameId, game.id)).all()).toEqual([]);
    expect((await admin.get('/api/admin/games?status=test')).body.games.map((g: any) => g.code)).toEqual([r.code]);
    expect(auditCount('admin.lab.test_auction')).toBe(1);

    const loaded = (await admin.get(`/api/admin/lab/teams?game=${r.code}`)).body;
    expect(loaded.teams).toHaveLength(40);
    expect(loaded.game.teamIds).toHaveLength(20);
    const ran = await admin.post('/api/admin/lab/run', { teamIds: loaded.game.teamIds, seed: loaded.game.seed, runs: 1 });
    expect(ran.status, JSON.stringify(ran.body)).toBe(200);
    const run = ran.body.result;
    const stored = t.db.select().from(standingRows).all().filter((s) => s.matchday === 38);
    const champion = run.teams.find((x: any) => x.last.position === 1);
    expect(champion.name).toBe(r.championName);
    expect(run.teams.map((x: any) => x.last.points).sort((a: number, b: number) => b - a)).toEqual(stored.map((s) => s.points).sort((a, b) => b - a));
  });
});

describe('admin users', () => {
  it('filters users and shows their games', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const gus = await guest(t.app, 'Gus');
    const code = await createGame(admin);
    await gus.post(`/api/games/${code}/join`, team('Gus United'));
    expect((await admin.get('/api/admin/users?filter=guests')).body.users.map((u: any) => u.displayName)).toEqual(['Gus']);
    expect((await admin.get('/api/admin/users?filter=admins')).body.users.map((u: any) => u.username)).toEqual([ADMIN_NAME]);
    const detail = (await admin.get(`/api/admin/users/${await userId(gus)}`)).body.detail;
    expect(detail.user.games).toBe(1);
    expect(detail.games).toEqual([expect.objectContaining({ code, teamName: 'Gus United', isHost: false, status: 'lobby' })]);
  });

  it("deletes a user's data, keeping finished games, and refuses while they are mid-game", async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const host = await signUp(t.app, 'leaver');
    const id = await userId(host);
    const code = await createGame(host, 'Leaver Cup');
    await host.post(`/api/games/${code}/bots`, { level: 'easy', formation: '4-4-2' });
    await host.post(`/api/games/${code}/chat`, { body: 'hello all' });

    expect((await admin.post(`/api/admin/users/${id}/delete`, { confirm: 'leaver' })).body.error.code).toBe('USER_IN_GAME');
    await host.post(`/api/games/${code}/start`, { force: true });
    await host.post(`/api/games/${code}/auction/end`);
    await host.post(`/api/games/${code}/season/start`);
    const game = t.db.select().from(games).where(eq(games.joinCode, code)).get()!;
    if (game.status !== 'completed') {
      t.db.update(games).set({ status: 'completed' }).where(eq(games.id, game.id)).run();
    }

    expect((await admin.post(`/api/admin/users/${id}/delete`, { confirm: 'wrong' })).body.error.code).toBe('CONFIRM_MISMATCH');
    expect((await admin.post(`/api/admin/users/${await userId(admin)}/delete`, { confirm: ADMIN_NAME })).body.error.code).toBe('SELF_DELETE');
    expect((await admin.post(`/api/admin/users/${id}/delete`, { confirm: 'leaver' })).status).toBe(204);

    expect(t.db.select().from(users).where(eq(users.id, id)).get()).toBeUndefined();
    expect(t.db.select().from(chatMessages).where(eq(chatMessages.gameId, game.id)).all().filter((m) => m.body === 'hello all')).toEqual([]);
    const after = t.db.select().from(games).where(eq(games.id, game.id)).get()!;
    expect(after.hostUserId).toBe(await userId(admin));
    const teams = t.db.select().from(participants).where(eq(participants.gameId, game.id)).all();
    expect(teams).toHaveLength(2);
    expect(teams.every((p) => p.userId === null)).toBe(true);
    expect((await host.get('/api/auth/me')).body.user).toBeNull();
    expect(t.db.select().from(auditLog).where(eq(auditLog.action, 'admin.user.delete')).get()!.details).toMatchObject({ username: 'leaver', hostedGamesReassigned: 1, chatMessagesDeleted: 1 });
  });
});

describe('admin audit log', () => {
  it('filters by actor, action, game and date, pages, and exports CSV', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const host = await signUp(t.app, 'hosty');
    const code = await createGame(host);
    await host.post(`/api/games/${code}/bots`, { level: 'easy', formation: '4-4-2' });
    for (let i = 0; i < 3; i++) await admin.put('/api/admin/settings', { key: 'league_name', value: `League ${i}` });

    const all = (await admin.get('/api/admin/audit')).body.entries;
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all[0]).toMatchObject({ action: 'admin.settings.update', actor: { username: ADMIN_NAME }, target: 'league_name' });

    const byActor = (await admin.get('/api/admin/audit?actor=host')).body.entries;
    expect(byActor.length).toBeGreaterThan(0);
    expect(byActor.every((e: any) => e.actor.username === 'hosty')).toBe(true);
    const byAction = (await admin.get('/api/admin/audit?action=admin.settings')).body.entries;
    expect(byAction).toHaveLength(3);
    const byGame = (await admin.get(`/api/admin/audit?game=${code.toLowerCase()}`)).body.entries;
    expect(byGame.length).toBeGreaterThan(0);
    expect(byGame.every((e: any) => e.gameCode === code)).toBe(true);
    expect((await admin.get(`/api/admin/audit?from=${Date.now() + 60_000}`)).body.entries).toEqual([]);

    const page1 = (await admin.get('/api/admin/audit?limit=2')).body;
    expect(page1.entries).toHaveLength(2);
    const page2 = (await admin.get(`/api/admin/audit?limit=2&before=${page1.nextBefore}`)).body;
    expect(page2.entries[0].id).toBeLessThan(page1.entries[1].id);

    const csv = await download(admin, '/api/admin/audit/export?action=admin.settings');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.trim().split(/\r\n/);
    expect(lines[0]).toBe('id,at,actor,action,target,game,details');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('admin.settings.update');
  });
});
