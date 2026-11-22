import { describe, expect, it } from 'vitest';
import { is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig as sqliteConfig } from 'drizzle-orm/sqlite-core';
import { PgTable, getTableConfig as pgConfig } from 'drizzle-orm/pg-core';
import * as sqliteSchema from '../src/db/schema';
import * as pgSchema from '../src/db/schema.pg';
import { closeDb, openDb, runMigrations } from '../src/db/client';

interface Shape {
  columns: Record<string, { notNull: boolean; primary: boolean }>;
  primaryKey: string[];
  uniqueIndexes: string[];
  indexes: string[];
  foreignKeys: string[];
}

function sqliteShapes(): Record<string, Shape> {
  const out: Record<string, Shape> = {};
  for (const t of Object.values(sqliteSchema)) {
    if (!is(t, SQLiteTable)) continue;
    const c = sqliteConfig(t);
    out[c.name] = {
      columns: Object.fromEntries(c.columns.map((col) => [col.name, { notNull: col.notNull, primary: col.primary }])),
      primaryKey: c.primaryKeys.flatMap((pk) => pk.columns.map((col) => col.name)),
      uniqueIndexes: c.indexes.filter((i) => i.config.unique).map((i) => i.config.name).sort(),
      indexes: c.indexes.filter((i) => !i.config.unique).map((i) => i.config.name).sort(),
      foreignKeys: c.foreignKeys
        .map((fk) => {
          const r = fk.reference();
          return `${r.columns.map((x) => x.name).join(',')}->${sqliteConfig(r.foreignTable).name}.${r.foreignColumns.map((x) => x.name).join(',')}:${fk.onDelete ?? 'no action'}`;
        })
        .sort(),
    };
  }
  return out;
}

function pgShapes(): Record<string, Shape> {
  const out: Record<string, Shape> = {};
  for (const t of Object.values(pgSchema)) {
    if (!is(t, PgTable)) continue;
    const c = pgConfig(t);
    out[c.name] = {
      columns: Object.fromEntries(c.columns.map((col) => [col.name, { notNull: col.notNull, primary: col.primary }])),
      primaryKey: c.primaryKeys.flatMap((pk) => pk.columns.map((col) => col.name)),
      uniqueIndexes: c.indexes.filter((i) => i.config.unique).map((i) => i.config.name ?? '').sort(),
      indexes: c.indexes.filter((i) => !i.config.unique).map((i) => i.config.name ?? '').sort(),
      foreignKeys: c.foreignKeys
        .map((fk) => {
          const r = fk.reference();
          return `${r.columns.map((x) => x.name).join(',')}->${pgConfig(r.foreignTable).name}.${r.foreignColumns.map((x) => x.name).join(',')}:${fk.onDelete ?? 'no action'}`;
        })
        .sort(),
    };
  }
  return out;
}

const SPEC_TABLES = [
  'users',
  'clubs',
  'seed_players',
  'pool_players',
  'games',
  'participants',
  'game_pool',
  'lots',
  'bids',
  'lineup_slots',
  'watchlist',
  'seasons',
  'season_teams',
  'fixtures',
  'match_events',
  'standing_rows',
  'player_season_stats',
  'app_settings',
  'audit_log',
  'chat_messages',
];

describe('schema', () => {
  it('has every table from spec section 3', () => {
    const tables = Object.keys(sqliteShapes());
    for (const t of SPEC_TABLES) expect(tables).toContain(t);
  });

  it('Postgres mirror matches the SQLite schema table for table and column for column', () => {
    expect(pgShapes()).toEqual(sqliteShapes());
  });

  it('SQLite migrations create exactly the columns the schema declares', () => {
    const db = openDb(':memory:');
    try {
      runMigrations(db);
      for (const [table, shape] of Object.entries(sqliteShapes())) {
        const cols = db.$client.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
        expect(cols.map((c) => c.name).sort(), table).toEqual(Object.keys(shape.columns).sort());
      }
    } finally {
      closeDb(db);
    }
  });
});
