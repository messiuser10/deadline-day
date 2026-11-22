import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { closeDb, openDb, runMigrations, seedDatabase } from '../src/db';
import { parseDatabaseUrl } from '../src/db/client';
import { loadData } from '../src/data/load';

describe('health', () => {
  it('reports the pool size', async () => {
    const db = openDb(':memory:');
    runMigrations(db);
    const app = buildApp({ db });
    try {
      const empty = await app.inject({ method: 'GET', url: '/api/health' });
      expect(empty.json()).toMatchObject({ status: 'ok', app: 'Deadline Day', seeded: false });
      seedDatabase(db, loadData());
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', app: 'Deadline Day', poolPlayers: 570, seeded: true });
    } finally {
      await app.close();
      closeDb(db);
    }
  });
});

describe('DATABASE_URL', () => {
  it('parses SQLite and Postgres URLs', () => {
    expect(parseDatabaseUrl(':memory:')).toEqual({ kind: 'sqlite', path: ':memory:' });
    expect(parseDatabaseUrl('file::memory:')).toEqual({ kind: 'sqlite', path: ':memory:' });
    expect(parseDatabaseUrl('file:/tmp/x.sqlite')).toEqual({ kind: 'sqlite', path: '/tmp/x.sqlite' });
    expect(parseDatabaseUrl('file:./var/dd.sqlite').kind).toBe('sqlite');
    expect(parseDatabaseUrl('postgres://u:p@h/db')).toEqual({ kind: 'postgres', url: 'postgres://u:p@h/db' });
  });
});
