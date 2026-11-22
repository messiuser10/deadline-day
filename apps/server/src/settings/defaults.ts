/**
 * Default app_settings rows. The seed inserts any key that is missing and never overwrites
 * a key that exists, so admin edits survive re-seeding and new keys appear after upgrades.
 * Later milestones add keys here (simulation parameters, table bands, and so on).
 */
import {
  DEFAULT_POOL_PARAMS,
  DEFAULT_PRICE_PARAMS,
  DEFAULT_SLOT_COMPATIBILITY,
  FORMATION_IDS,
  MAX_TEAMS,
} from '@deadline-day/engine';

export const DEFAULT_GAME_SETTINGS = {
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
  playbackMode: 'synchronized' as 'synchronized' | 'own_pace',
  autoStartSeason: true,
  formationRule: 'each' as 'each' | 'forced',
  visibility: 'private' as 'private' | 'public',
};

export function defaultAppSettings(): Record<string, unknown> {
  return {
    league_name: 'Deadline Day League',
    slot_compatibility: DEFAULT_SLOT_COMPATIBILITY,
    formations_enabled: [...FORMATION_IDS],
    price_curve: DEFAULT_PRICE_PARAMS,
    pool_params: DEFAULT_POOL_PARAMS,
    game_defaults: DEFAULT_GAME_SETTINGS,
    remove_bought_from_ai: true,
    ai_club_selection: { method: 'top_by_strength', manualClubIds: [] as string[] },
    public_lobbies_enabled: true,
    registrations_open: true,
    maintenance_banner: { message: null as string | null },
  };
}
