import { buildApp } from './app';
import { loadConfig, secureCookies, sessionSecret, webDistDir } from './config';
import { loadData } from './data/load';
import { isSeeded, openDb, runMigrations, seedDatabase } from './db';
import { findWebBuild } from './web';

const config = loadConfig();
const db = openDb(config.DATABASE_URL);
runMigrations(db);

// A fresh database (first start of a deployment) is filled from data/ at once; later starts leave it alone.
const freshDb = !isSeeded(db);
if (freshDb) seedDatabase(db, loadData(), { reset: false });

const production = config.NODE_ENV === 'production';
const webDir = production ? findWebBuild(webDistDir(config)) : null;

const app = buildApp({
  db,
  logger: true,
  adminUsername: config.ADMIN_USERNAME,
  sessionSecret: sessionSecret(config),
  secureCookies: secureCookies(config),
  webDir,
});
if (freshDb) app.log.info('Empty database: seeded clubs, squads, the auction pool and settings from data/');
if (production && !webDir) app.log.warn(`No web build in ${webDistDir(config)}: run npm run build. Serving the API only.`);

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
