import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, GameSnapshot, ServerToClientEvents, WatchAck } from '@deadline-day/protocol';
import { type Client, createGame, guest, signUp, team, testApp, type TestApp } from './helpers';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let t: TestApp;
let url: string;
const sockets: ClientSocket[] = [];

beforeEach(async () => {
  t = await testApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = t.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  url = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await t.close();
});

async function open(c: Client | null): Promise<ClientSocket> {
  const s: ClientSocket = connect(url, {
    path: '/socket.io',
    transports: ['websocket'],
    extraHeaders: c?.cookie ? { cookie: c.cookie } : {},
    reconnection: false,
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
  return s;
}

const watch = (s: ClientSocket, code: string) => new Promise<WatchAck>((resolve) => s.emit('game:watch', { code }, resolve));

function next<E extends keyof ServerToClientEvents>(s: ClientSocket, event: E, timeoutMs = 2000): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s.once(event as any, (payload: any) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('realtime', () => {
  it('sends the snapshot on watch, then lobby updates, presence and chat', async () => {
    const host = await signUp(t.app, 'hosty');
    const code = await createGame(host);
    const hs = await open(host);

    const ack = await watch(hs, code.toLowerCase());
    expect(ack.ok).toBe(true);
    const snap = (ack as { snapshot: GameSnapshot }).snapshot;
    expect(snap.game.code).toBe(code);
    expect(snap.participants[0]!.isConnected).toBe(true);

    const p2 = await guest(t.app, 'Two');
    const update = next(hs, 'lobby:update');
    await p2.post(`/api/games/${code}/join`, team('Second City'));
    expect((await update).participants.map((p) => p.teamName)).toEqual(['Host Town', 'Second City']);

    const s2 = await open(p2);
    const online = next(hs, 'presence');
    await watch(s2, code);
    expect(await online).toMatchObject({ isConnected: true });

    const chat = next(s2, 'chat:message');
    await host.post(`/api/games/${code}/chat`, { body: 'welcome' });
    expect(await chat).toMatchObject({ body: 'welcome', name: 'hosty' });

    const offline = next(hs, 'presence');
    s2.disconnect();
    expect(await offline).toMatchObject({ isConnected: false });
  });

  it('lets anyone spectate, and errors on unknown codes', async () => {
    const host = await signUp(t.app, 'hosty');
    const code = await createGame(host);
    const anon = await open(null);
    expect((await watch(anon, code)).ok).toBe(true);
    const bad = await watch(anon, 'ZZZZZZ');
    expect(bad).toEqual({ ok: false, error: expect.objectContaining({ code: 'GAME_NOT_FOUND' }) });
  });

  it('pushes the full snapshot when the auction starts', async () => {
    const host = await signUp(t.app, 'hosty');
    const code = await createGame(host);
    await host.post(`/api/games/${code}/bots`, {});
    const hs = await open(host);
    await watch(hs, code);
    const started = next(hs, 'game:snapshot');
    await host.post(`/api/games/${code}/start`, {});
    const snap = await started;
    expect(snap.game.status).toBe('auctioning');
    expect(snap.aiClubs.inLeague).toHaveLength(18);
  });

  it('tells a kicked player and stops sending them the game', async () => {
    const host = await signUp(t.app, 'hosty');
    const code = await createGame(host);
    const p2 = await guest(t.app, 'Two');
    const pid = (await p2.post(`/api/games/${code}/join`, team('Second City'))).body.participantId as string;
    const s2 = await open(p2);
    await watch(s2, code);

    const kicked = next(s2, 'game:kicked');
    await host.del(`/api/games/${code}/participants/${pid}`);
    expect(await kicked).toEqual({ code });

    let gotUpdate = false;
    s2.on('lobby:update', () => {
      gotUpdate = true;
    });
    await host.patch(`/api/games/${code}/settings`, { settings: { budgetM: 900 } });
    await new Promise((r) => setTimeout(r, 100));
    expect(gotUpdate).toBe(false);
  });

  it('answers time sync', async () => {
    const s = await open(null);
    const before = Date.now();
    const serverTime = await new Promise<number>((resolve) => s.emit('time:sync', resolve));
    expect(serverTime).toBeGreaterThanOrEqual(before - 5);
    expect(serverTime).toBeLessThanOrEqual(Date.now() + 5);
  });
});
