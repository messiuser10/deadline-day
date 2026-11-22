/**
 * npm run seed            insert missing clubs, squads, pool players and settings (idempotent)
 * npm run seed -- --reset also overwrite existing clubs, squads and pool players from data/
 */
import { loadConfig } from '@deadline-day/server/config';
import { loadData } from '@deadline-day/server/data';
import { DataValidationError, closeDb, openDb, parseDatabaseUrl, runMigrations, seedDatabase } from '@deadline-day/server/db';

const reset = process.argv.includes('--reset');
const config = loadConfig();
const target = parseDatabaseUrl(config.DATABASE_URL);
console.log(`Seeding ${target.kind === 'sqlite' ? target.path : 'Postgres'}${reset ? ' (reset)' : ''}`);

const db = openDb(config.DATABASE_URL);
try {
  runMigrations(db);
  const result = seedDatabase(db, loadData(), { reset });
  const line = (label: string, r: { inserted: number; after: number }) =>
    console.log(`  ${label.padEnd(14)} ${String(r.after).padStart(4)} rows (${r.inserted} new)`);
  line('clubs', result.clubs);
  line('seed_players', result.seedPlayers);
  line('pool_players', result.poolPlayers);
  line('app_settings', result.appSettings);
  console.log('Done.');
} catch (err) {
  if (err instanceof DataValidationError) {
    console.error(err.message);
    for (const e of err.errors.slice(0, 20)) console.error(`  - ${e}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  closeDb(db);
}
