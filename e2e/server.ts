/**
 * The server the smoke test runs against: the production build (API, realtime and the web app in one
 * process) on a fresh seeded database, with quick bots and short timers so a whole game fits in a few
 * minutes. Started by Playwright (see playwright.config.ts); run `npm run build` first.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_GAME_LIMITS } from '@deadline-day/protocol';
import { buildApp } from '../apps/server/src/app';
import { loadData } from '../apps/server/src/data/load';
import { openDb, runMigrations, seedDatabase } from '../apps/server/src/db';
import { REPO_ROOT } from '../apps/server/src/paths';
import { writeAppSetting } from '../apps/server/src/settings/store';
import { findWebBuild } from '../apps/server/src/web';

const port = Number(process.env.E2E_PORT ?? 3199);
const tmp = join(REPO_ROOT, 'e2e', '.tmp');
const dbFile = join(tmp, 'e2e.sqlite');

mkdirSync(tmp, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(dbFile + suffix, { force: true });

const webDir = findWebBuild(join(REPO_ROOT, 'apps', 'web', 'dist'));
if (!webDir) throw new Error('No web build in apps/web/dist. Run npm run build first.');

const db = openDb(`file:${dbFile}`);
runMigrations(db);
seedDatabase(db, loadData(), { reset: false });
// Admin-editable limits, lowered so the test can pick 3 s lots and 5 s nominations.
writeAppSetting(db, 'game_limits', { ...DEFAULT_GAME_LIMITS, lotTimerS: [3, 120], nominationTimerS: [5, 120] });

const app = buildApp({
  db,
  webDir,
  sessionSecret: 'e2e-only-session-secret-0123456789',
  passwordCost: 4,
  startCountdownMs: 1000,
  botDelayMs: [150, 450],
  autoNominateDelayMs: 300,
  monteCarloRuns: 50,
});
await app.listen({ port, host: '127.0.0.1' });
console.log(`e2e server on http://127.0.0.1:${port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}
