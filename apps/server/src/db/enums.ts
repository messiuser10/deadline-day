/** Enumerations shared by the SQLite and Postgres schemas. */

export const GAME_STATUSES = [
  'lobby',
  'auctioning',
  'paused',
  'auction_complete',
  'simulating',
  'completed',
  'cancelled',
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];
