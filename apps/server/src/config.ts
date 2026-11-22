import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { REPO_ROOT } from './paths';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1).default('file:./var/deadline-day.sqlite'),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  SESSION_SECRET: z.string().min(16).default('dev-only-session-secret-change-me'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
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
  if (config.NODE_ENV === 'production' && config.SESSION_SECRET.startsWith('dev-only')) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  return config;
}
