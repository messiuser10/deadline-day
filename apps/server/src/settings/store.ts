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
