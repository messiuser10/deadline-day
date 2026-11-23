/**
 * Admin: app settings (section 11, tab 5) and the site-wide banner (tab 9). Each key is checked with
 * its zod schema and then against the other settings, so the stored set always stays consistent.
 */
import { FORMATION_IDS } from '@deadline-day/engine';
import {
  settingValueSchemas,
  type AdminSettingsView,
  type AppSettings,
  type EditableSettingKey,
  type GameSettings,
  type TableBand,
} from '@deadline-day/protocol';
import { audit } from '../audit';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { clubs } from '../db/schema';
import { badRequest, parse } from '../errors';
import type { GameService } from '../games/service';
import { defaultAppSettings } from '../settings/defaults';
import { writeAppSetting } from '../settings/store';

const BANNER: EditableSettingKey = 'maintenance_banner';

function overlappingBands(bands: TableBand[]): [TableBand, TableBand] | null {
  const on = bands.filter((b) => b.enabled).sort((a, b) => a.from - b.from);
  for (let i = 1; i < on.length; i++) if (on[i]!.from <= on[i - 1]!.to) return [on[i - 1]!, on[i]!];
  return null;
}

export class SettingsAdmin {
  constructor(
    private readonly db: Db,
    private readonly games: GameService,
  ) {}

  view(): AdminSettingsView {
    return { settings: this.games.appSettings(), defaults: defaultAppSettings(), formations: [...FORMATION_IDS] };
  }

  /** Checks that need the other settings. Throws 400 with a message the form can show. */
  private crossCheck(key: EditableSettingKey, value: unknown, app: AppSettings): void {
    const next = { ...app, [key]: value } as AppSettings;
    const defaultsFit = (what: string) => {
      try {
        this.games.validateSettings(next.game_defaults, next);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'invalid';
        throw badRequest('SETTINGS_CONFLICT', `${what}: the default game settings would no longer be valid (${message})`);
      }
    };
    switch (key) {
      case 'game_defaults':
        this.games.validateSettings(value as GameSettings, app);
        break;
      case 'game_limits':
        defaultsFit('Limits');
        break;
      case 'formations_enabled':
        defaultsFit('Formations');
        break;
      case 'public_lobbies_enabled':
        defaultsFit('Public lobbies');
        break;
      case 'ai_club_selection': {
        const ids = (value as AppSettings['ai_club_selection']).manualClubIds;
        const known = new Set(this.db.select({ id: clubs.id }).from(clubs).all().map((c) => c.id));
        const unknown = ids.filter((id) => !known.has(id));
        if (unknown.length) throw badRequest('CLUB_NOT_FOUND', `Unknown club: ${unknown.join(', ')}`);
        if (new Set(ids).size !== ids.length) throw badRequest('DUPLICATE_CLUB', 'Each club can be picked once');
        break;
      }
      case 'table_bands': {
        const clash = overlappingBands(value as TableBand[]);
        if (clash) throw badRequest('BANDS_OVERLAP', `"${clash[0].label}" and "${clash[1].label}" cover the same places`);
        break;
      }
      default:
        break;
    }
  }

  update(admin: UserRow, key: EditableSettingKey, raw: unknown): AdminSettingsView {
    const value = parse(settingValueSchemas[key], raw) as unknown;
    const app = this.games.appSettings();
    this.crossCheck(key, value, app);
    const before = app[key];
    this.db.transaction((tx) => {
      writeAppSetting(tx, key, value);
      if (key === 'game_defaults') {
        const d = value as GameSettings;
        writeAppSetting(tx, 'pool_params', { extraMin: d.extraMin, extraPct: d.extraPct });
        writeAppSetting(tx, 'remove_bought_from_ai', d.removeBoughtFromAi);
      }
    });
    if (key === BANNER) {
      const message = (value as AppSettings['maintenance_banner']).message;
      audit(this.db, { actorUserId: admin.id, action: message ? 'admin.announcement.set' : 'admin.announcement.clear', target: key, details: { from: (before as AppSettings['maintenance_banner']).message, to: message } });
    } else {
      // The profanity list can be thousands of words: log what changed, not both lists.
      const details =
        key === 'profanity_words'
          ? (() => {
              const was = new Set(before as string[]);
              const now = new Set(value as string[]);
              return { added: [...now].filter((w) => !was.has(w)).length, removed: [...was].filter((w) => !now.has(w)).length, total: now.size };
            })()
          : { from: before, to: value };
      audit(this.db, { actorUserId: admin.id, action: 'admin.settings.update', target: key, details });
    }
    if (key === 'formations_enabled' || key === 'ai_club_selection') this.games.reference.invalidate();
    return this.view();
  }
}
