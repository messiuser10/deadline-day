/** Fixed limits and palettes shared by the server and the web app. */

/** Team colours offered in the lobby. Any #RRGGBB is accepted; these are the quick picks. */
export const TEAM_COLORS = [
  '#22c36b',
  '#3b82f6',
  '#ef4444',
  '#f5c542',
  '#a855f7',
  '#f97316',
  '#14b8a6',
  '#ec4899',
  '#e5e7eb',
  '#64748b',
  '#84cc16',
  '#0ea5e9',
] as const;

export const BOT_TEAM_NAMES = [
  'Gavel United',
  'Late Bid Rovers',
  'Panic Buy City',
  'Reserve Price FC',
  'Max Bid Athletic',
  'Sell-On Sporting',
  'Release Clause Rangers',
  'Loan Army Albion',
  'Sealed Bid Town',
  'Medical Pending FC',
  'Here We Go Wanderers',
  'Window Shoppers',
] as const;

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 6;

/** Allowed ranges for game settings. Admin-editable in M6 (app_settings key `game_limits`). */
export interface GameLimits {
  budgetM: [number, number];
  nominationTimerS: [number, number];
  lotTimerS: [number, number];
  antiSnipeS: [number, number];
  minIncrementM: [number, number];
  extraMin: [number, number];
  extraPct: [number, number];
}

export const DEFAULT_GAME_LIMITS: GameLimits = {
  budgetM: [200, 5000],
  nominationTimerS: [10, 120],
  lotTimerS: [5, 120],
  antiSnipeS: [0, 30],
  minIncrementM: [1, 50],
  extraMin: [0, 10],
  extraPct: [0, 1],
};

export const START_COUNTDOWN_MS = 5000;
export const CHAT_HISTORY = 50;
export const CHAT_MAX_LENGTH = 280;
