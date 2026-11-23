import type { Db } from '../db/client';
import { appSettings } from '../db/schema';
import { defaultAppSettings, type AppSettings } from './defaults';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * All app settings: stored values over the defaults. Object values are merged one level deep,
 * so a key added to a default object in a later version still has a value.
 */
export function readAppSettings(db: Db): AppSettings {
  const out = defaultAppSettings() as unknown as Record<string, unknown>;
  for (const row of db.select().from(appSettings).all()) {
    if (!(row.key in out)) continue;
    const def = out[row.key];
    out[row.key] = isPlainObject(def) && isPlainObject(row.value) ? { ...def, ...row.value } : row.value;
  }
  return out as unknown as AppSettings;
}

/** Insert or replace one app_settings row. Callers validate the value first. */
export function writeAppSetting(db: Pick<Db, 'insert'>, key: keyof AppSettings, value: unknown): void {
  const now = Date.now();
  db.insert(appSettings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } })
    .run();
}
