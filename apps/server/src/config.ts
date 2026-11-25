import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { parseDatabaseUrl } from './db/client';
import { REPO_ROOT } from './paths';

const DEV_SESSION_SECRET = 'dev-only-session-secret-change-me';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1).default('file:./var/deadline-day.sqlite'),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  /** Optional: when unset, production creates one and keeps it in a file beside the database. */
  SESSION_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(16).optional()),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** Built web app served in production (relative to the repo root unless absolute). */
  WEB_DIST_DIR: z.string().min(1).default('apps/web/dist'),
  /** Secure session cookie: auto means on in production. Set false only for plain-HTTP play on a home network. */
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
});

export type Config = z.infer<typeof envSchema>;

let loadedEnvFile = false;

/** Read .env from the repo root once (if present), then validate the environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (!loadedEnvFile && env === process.env) {
    loadedEnvFile = true;
    const file = join(REPO_ROOT, '.env');
    if (existsSync(file)) process.loadEnvFile(file);
  }
  const config = envSchema.parse(env);
  if (config.NODE_ENV === 'production' && config.SESSION_SECRET && /^(dev-only|change-me)/.test(config.SESSION_SECRET)) {
    throw new Error('SESSION_SECRET must be a long random string in production (or left unset to generate one)');
  }
  return config;
}

/**
 * The cookie-signing secret. SESSION_SECRET wins when set. Otherwise production generates a random one on
 * first start and saves it as `session-secret` next to the SQLite file, so logins survive restarts for as
 * long as the database does. Development uses a fixed dev-only value.
 */
export function sessionSecret(config: Config): string {
  if (config.SESSION_SECRET) return config.SESSION_SECRET;
  if (config.NODE_ENV !== 'production') return DEV_SESSION_SECRET;
  const target = parseDatabaseUrl(config.DATABASE_URL);
  if (target.kind !== 'sqlite' || target.path === ':memory:') return randomBytes(32).toString('hex');
  const file = join(dirname(target.path), 'session-secret');
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  }
  const secret = randomBytes(32).toString('hex');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}

export function webDistDir(config: Config): string {
  return isAbsolute(config.WEB_DIST_DIR) ? config.WEB_DIST_DIR : join(REPO_ROOT, config.WEB_DIST_DIR);
}

export function secureCookies(config: Config): boolean {
  return config.COOKIE_SECURE === 'auto' ? config.NODE_ENV === 'production' : config.COOKIE_SECURE === 'true';
}
