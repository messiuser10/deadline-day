/**
 * Loads the supplied data into the database (section 5). Idempotent.
 *
 * Default mode inserts missing rows and leaves existing rows alone, so admin edits survive.
 * `reset: true` also overwrites existing clubs, squad players and pool players from the files.
 * app_settings keys are only ever inserted when missing.
 */
import { count, sql } from 'drizzle-orm';
import { clubId, defaultMonogram } from '@deadline-day/engine';
import type { LoadedData } from '../data/load';
import { defaultAppSettings } from '../settings/defaults';
import type { Db } from './client';
import { appSettings, clubs, poolPlayers, seedPlayers } from './schema';

export interface SeedOptions {
  reset?: boolean;
}

export interface TableSeedResult {
  before: number;
  after: number;
  inserted: number;
}

export interface SeedResult {
  clubs: TableSeedResult;
  seedPlayers: TableSeedResult;
  poolPlayers: TableSeedResult;
  appSettings: TableSeedResult;
  reset: boolean;
}

export class DataValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Data validation failed with ${errors.length} error(s). Run npm run data:validate for details.`);
  }
}

export function seedDatabase(db: Db, data: LoadedData, options: SeedOptions = {}): SeedResult {
  if (data.report.errors.length > 0) throw new DataValidationError(data.report.errors);
  const reset = options.reset ?? false;

  const countOf = (table: typeof clubs | typeof seedPlayers | typeof poolPlayers | typeof appSettings) =>
    db.select({ n: count() }).from(table).get()?.n ?? 0;
  const before = {
    clubs: countOf(clubs),
    seedPlayers: countOf(seedPlayers),
    poolPlayers: countOf(poolPlayers),
    appSettings: countOf(appSettings),
  };

  db.transaction((tx) => {
    for (const c of data.clubs) {
      const row = {
        id: clubId(c.name),
        name: c.name,
        shortName: c.shortName,
        country: c.country,
        leagueName: c.leagueName,
        primaryColor: c.primaryColor,
        secondaryColor: c.secondaryColor,
        monogram: defaultMonogram(c.name),
      };
      const q = tx.insert(clubs).values(row);
      if (reset) {
        // Keep admin-owned fields (monogram, notes, strength override, cached strength).
        const { id: _id, monogram: _monogram, ...fromFile } = row;
        q.onConflictDoUpdate({ target: clubs.id, set: fromFile }).run();
      } else {
        q.onConflictDoNothing().run();
      }
    }

    for (const p of data.seedPlayers) {
      const row = {
        id: p.id,
        clubId: clubId(p.club),
        fullName: p.name,
        primaryPosition: p.primaryPosition,
        altPositions: p.altPositions,
        overall: p.overall,
        nationality: p.nationality,
      };
      const q = tx.insert(seedPlayers).values(row);
      if (reset) {
        const { id: _id, ...rest } = row;
        q.onConflictDoUpdate({ target: seedPlayers.id, set: rest }).run();
      } else {
        q.onConflictDoNothing().run();
      }
    }

    for (const p of data.masterPlayers) {
      const row = {
        id: p.id,
        name: p.name,
        position: p.position,
        altPositions: p.altPositions,
        altSource: p.altSource,
        overall: p.overall,
        positionRank: p.positionRank,
        marketValueM: p.marketValueM,
        basePriceM: p.basePriceM,
        seedClub: p.seedClub === null ? null : clubId(p.seedClub),
        nationality: p.nationality,
        isActive: true,
      };
      const q = tx.insert(poolPlayers).values(row);
      if (reset) {
        const { id: _id, ...rest } = row;
        q.onConflictDoUpdate({ target: poolPlayers.id, set: rest }).run();
      } else {
        q.onConflictDoNothing().run();
      }
    }

    for (const [key, value] of Object.entries(defaultAppSettings())) {
      tx.insert(appSettings)
        .values({ key, value, updatedAt: Date.now() })
        .onConflictDoNothing()
        .run();
    }
  });

  const after = {
    clubs: countOf(clubs),
    seedPlayers: countOf(seedPlayers),
    poolPlayers: countOf(poolPlayers),
    appSettings: countOf(appSettings),
  };
  const result = (k: keyof typeof before): TableSeedResult => ({
    before: before[k],
    after: after[k],
    inserted: after[k] - before[k],
  });
  return {
    clubs: result('clubs'),
    seedPlayers: result('seedPlayers'),
    poolPlayers: result('poolPlayers'),
    appSettings: result('appSettings'),
    reset,
  };
}

/** True when the reference tables already hold data (used by the server to warn about an empty database). */
export function isSeeded(db: Db): boolean {
  const n = db.select({ n: sql<number>`count(*)` }).from(poolPlayers).get()?.n ?? 0;
  return n > 0;
}
