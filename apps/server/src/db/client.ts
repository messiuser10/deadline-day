import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { REPO_ROOT, SQLITE_MIGRATIONS_DIR } from '../paths';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export type DatabaseTarget = { kind: 'sqlite'; path: string } | { kind: 'postgres'; url: string };

/**
 * Parse DATABASE_URL.
 * - `file:<path>` or a bare path: SQLite file (relative paths resolve from the repo root)
 * - `:memory:` or `file::memory:`: in-memory SQLite (tests)
 * - `postgres://` or `postgresql://`: Postgres
 */
export function parseDatabaseUrl(url: string): DatabaseTarget {
  if (/^postgres(ql)?:\/\//.test(url)) return { kind: 'postgres', url };
  const raw = url.startsWith('file:') ? url.slice('file:'.length) : url;
  if (raw === ':memory:') return { kind: 'sqlite', path: ':memory:' };
  return { kind: 'sqlite', path: isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw) };
}

export function openDb(url: string): Db {
  const target = parseDatabaseUrl(url);
  if (target.kind === 'postgres') {
    throw new Error(
      'DATABASE_URL points at Postgres. The schema and migrations support Postgres (drizzle/pg), ' +
        'but the runtime driver is not wired yet; see DECISIONS.md. Use a file: URL for SQLite.',
    );
  }
  if (target.path !== ':memory:') mkdirSync(dirname(target.path), { recursive: true });
  const sqlite = new Database(target.path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema });
}

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: SQLITE_MIGRATIONS_DIR });
}

export function closeDb(db: Db): void {
  db.$client.close();
}
