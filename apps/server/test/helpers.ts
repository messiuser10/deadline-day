/* eslint-disable @typescript-eslint/no-explicit-any -- test responses are loosely typed JSON */
import type { InjectOptions } from 'fastify';
import type { TeamInput } from '@deadline-day/protocol';
import { buildApp, type AppOptions, type DeadlineDayApp } from '../src/app';
import { closeDb, openDb, runMigrations, seedDatabase, type Db } from '../src/db';
import { loadData } from '../src/data/load';

const data = loadData();

export const ADMIN_NAME = 'boss';

export interface TestApp {
  app: DeadlineDayApp;
  db: Db;
  close: () => Promise<void>;
}

/** A seeded in-memory app with fast hashing, no start countdown and no chat throttle. */
export async function testApp(options: Partial<AppOptions> = {}): Promise<TestApp> {
  const db = openDb(':memory:');
  runMigrations(db);
  seedDatabase(db, data);
  const app = buildApp({
    db,
    passwordCost: 4,
    startCountdownMs: 0,
    chatMinIntervalMs: 0,
    adminUsername: ADMIN_NAME,
    sessionSecret: 'test-secret-test-secret-test-secret',
    ...options,
  });
  await app.ready();
  return {
    app,
    db,
    close: async () => {
      await app.close();
      closeDb(db);
    },
  };
}

export interface Res<T = any> {
  status: number;
  body: T;
}

/** A browser-like client: keeps the session cookie between requests. */
export class Client {
  cookie: string | null = null;

  constructor(private readonly app: DeadlineDayApp) {}

  async req<T = any>(method: InjectOptions['method'], url: string, payload?: unknown): Promise<Res<T>> {
    const res = await this.app.inject({
      method,
      url,
      payload: payload as InjectOptions['payload'],
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
    const set = res.cookies.find((c) => c.name === 'dd_session');
    if (set) this.cookie = set.value ? `dd_session=${set.value}` : null;
    const text = res.body;
    return { status: res.statusCode, body: text ? (JSON.parse(text) as T) : (undefined as T) };
  }

  get = <T = any>(url: string) => this.req<T>('GET', url);
  post = <T = any>(url: string, body: unknown = {}) => this.req<T>('POST', url, body);
  patch = <T = any>(url: string, body: unknown = {}) => this.req<T>('PATCH', url, body);
  put = <T = any>(url: string, body: unknown = {}) => this.req<T>('PUT', url, body);
  del = <T = any>(url: string) => this.req<T>('DELETE', url);
}

export function team(name: string, overrides: Partial<TeamInput> = {}): TeamInput {
  return { teamName: name, color: '#22c36b', monogram: name.slice(0, 2).toUpperCase(), formation: '4-3-3', ...overrides };
}

/** Registers a user (password "password123") and returns a signed-in client. */
export async function signUp(app: DeadlineDayApp, username: string): Promise<Client> {
  const c = new Client(app);
  const res = await c.post('/api/auth/register', { username, password: 'password123' });
  if (res.status !== 201) throw new Error(`register ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

export async function guest(app: DeadlineDayApp, displayName: string): Promise<Client> {
  const c = new Client(app);
  const res = await c.post('/api/auth/guest', { displayName });
  if (res.status !== 201) throw new Error(`guest ${displayName}: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

/** Host creates a game; returns its code. */
export async function createGame(host: Client, name = 'Friday Draft', settings: Record<string, unknown> = {}): Promise<string> {
  const res = await host.post('/api/games', { name, settings, team: team('Host Town') });
  if (res.status !== 201) throw new Error(`create: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.code as string;
}
