/** npm run db:migrate: apply pending SQLite migrations to DATABASE_URL. */
import { loadConfig } from '@deadline-day/server/config';
import { closeDb, openDb, parseDatabaseUrl, runMigrations } from '@deadline-day/server/db';

const config = loadConfig();
const target = parseDatabaseUrl(config.DATABASE_URL);
const db = openDb(config.DATABASE_URL);
try {
  runMigrations(db);
  console.log(`Migrations applied to ${target.kind === 'sqlite' ? target.path : 'Postgres'}.`);
} finally {
  closeDb(db);
}
