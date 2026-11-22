import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Repository root (three levels above apps/server/src). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const DATA_DIR = join(REPO_ROOT, 'data');
export const SERVER_DIR = join(REPO_ROOT, 'apps', 'server');
export const SQLITE_MIGRATIONS_DIR = join(SERVER_DIR, 'drizzle', 'sqlite');
export const PG_MIGRATIONS_DIR = join(SERVER_DIR, 'drizzle', 'pg');
