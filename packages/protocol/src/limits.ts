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

// Auction (section 8) --------------------------------------------------------

/** Quick bid buttons, added to the current bid. */
export const QUICK_BID_STEPS = [1, 5, 10, 25] as const;
/** Host "extend the timer" adds this much. */
export const EXTEND_TIMER_MS = 10_000;
/** The host is offered a bot takeover once a manager has been gone this long. */
export const DISCONNECT_PROMPT_MS = 60_000;
/** Bots act after a human-feeling delay in this range. */
export const BOT_DELAY_MS: readonly [number, number] = [1_000, 4_000];
/** Countdown from the end of the Team Reveal to the season. */
export const SEASON_COUNTDOWN_MS = 10_000;
/** How long each team is on screen when the Team Reveal plays by itself. */
export const REVEAL_STEP_MS = 4_000;
/** The unsold list and the league preview get this long at the end of the reveal. */
export const REVEAL_TAIL_MS = 8_000;

/** Full reveal length before the season countdown starts. */
export function revealDurationMs(teams: number): number {
  return teams * REVEAL_STEP_MS + REVEAL_TAIL_MS;
}

export type RatingTier = 'elite' | 'gold' | 'silver' | 'bronze';

/** Elite 88+, Gold 82-87, Silver 78-81, Bronze below 78. */
export function ratingTier(overall: number): RatingTier {
  if (overall >= 88) return 'elite';
  if (overall >= 82) return 'gold';
  if (overall >= 78) return 'silver';
  return 'bronze';
}
