/**
 * Default app_settings rows. The seed inserts any key that is missing and never overwrites
 * a key that exists, so admin edits survive re-seeding and new keys appear after upgrades.
 * At runtime, readAppSettings() falls back to these values for any key missing from the table.
 */
import {
  DEFAULT_POOL_PARAMS,
  DEFAULT_PRICE_PARAMS,
  DEFAULT_SLOT_COMPATIBILITY,
  FORMATION_IDS,
  MAX_TEAMS,
  type FormationId,
  type PoolParams,
  type PriceParams,
  type SlotCompatibility,
} from '@deadline-day/engine';
import { DEFAULT_GAME_LIMITS, type GameLimits, type GameSettings } from '@deadline-day/protocol';
import { DEFAULT_PROFANITY_WORDS } from '../text/profanity';

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  maxTeams: MAX_TEAMS,
  budgetM: 1000,
  nominationTimerS: 30,
  lotTimerS: 20,
  antiSnipeS: 10,
  minIncrementM: 1,
  extraMin: DEFAULT_POOL_PARAMS.extraMin,
  extraPct: DEFAULT_POOL_PARAMS.extraPct,
  removeBoughtFromAi: true,
  botsAllowed: true,
  playbackMode: 'synchronized',
  autoStartSeason: true,
  formationRule: 'each',
  forcedFormation: null,
  visibility: 'private',
};

export type AiClubSelectionMethod = 'top_by_strength' | 'manual' | 'random';

export interface AppSettings {
  league_name: string;
  slot_compatibility: SlotCompatibility;
  formations_enabled: FormationId[];
  price_curve: PriceParams;
  pool_params: PoolParams;
  game_defaults: GameSettings;
  game_limits: GameLimits;
  remove_bought_from_ai: boolean;
  ai_club_selection: { method: AiClubSelectionMethod; manualClubIds: string[] };
  public_lobbies_enabled: boolean;
  registrations_open: boolean;
  profanity_words: string[];
  maintenance_banner: { message: string | null };
}

export function defaultAppSettings(): AppSettings {
  return structuredClone({
    league_name: 'Deadline Day League',
    slot_compatibility: DEFAULT_SLOT_COMPATIBILITY,
    formations_enabled: [...FORMATION_IDS],
    price_curve: DEFAULT_PRICE_PARAMS,
    pool_params: DEFAULT_POOL_PARAMS,
    game_defaults: DEFAULT_GAME_SETTINGS,
    game_limits: DEFAULT_GAME_LIMITS,
    remove_bought_from_ai: true,
    ai_club_selection: { method: 'top_by_strength', manualClubIds: [] },
    public_lobbies_enabled: true,
    registrations_open: true,
    profanity_words: [...DEFAULT_PROFANITY_WORDS],
    maintenance_banner: { message: null },
  });
}
