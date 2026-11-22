import { buildApp } from './app';
import { loadConfig } from './config';
import { isSeeded, openDb, runMigrations } from './db';

const config = loadConfig();
const db = openDb(config.DATABASE_URL);
runMigrations(db);

const app = buildApp({ db, logger: true });
if (!isSeeded(db)) app.log.warn('The database has no players yet. Run: npm run seed');

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      db.$client.close();
      process.exit(0);
    });
  });
}
