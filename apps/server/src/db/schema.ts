/**
 * Drizzle schema, SQLite dialect (section 3). This is the runtime schema.
 * schema.pg.ts mirrors it table for table and column for column; test/schema.test.ts keeps them in sync.
 *
 * Portability rules: text ids (UUIDs or slugs), integer money in whole millions, timestamps as
 * integer epoch milliseconds, JSON stored as JSON text (jsonb on Postgres), booleans as 0/1.
 */
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { GAME_STATUSES } from './enums';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer('created_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now());
const bool = (name: string) => integer(name, { mode: 'boolean' });
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

// ---------------------------------------------------------------------------
// Users and sessions

export const users = sqliteTable('users', {
  id: id(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  isGuest: bool('is_guest').notNull().default(false),
  banned: bool('banned').notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Reference data: AI clubs, their squads, and the master auction pool

export const clubs = sqliteTable('clubs', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  shortName: text('short_name').notNull(),
  country: text('country').notNull(),
  leagueName: text('league_name').notNull(),
  primaryColor: text('primary_color').notNull(),
  secondaryColor: text('secondary_color').notNull(),
  monogram: text('monogram'),
  strengthRating: real('strength_rating'),
  strengthOverride: real('strength_override'),
  notes: text('notes'),
});

export const seedPlayers = sqliteTable(
  'seed_players',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    primaryPosition: text('primary_position').notNull(),
    altPositions: json<string[]>('alt_positions').notNull().default(sql`'[]'`),
    overall: integer('overall').notNull(),
    nationality: text('nationality'),
  },
  (t) => [index('seed_players_club_idx').on(t.clubId)],
);

export const poolPlayers = sqliteTable(
  'pool_players',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    position: text('position').notNull(),
    altPositions: json<string[]>('alt_positions').notNull().default(sql`'[]'`),
    altSource: text('alt_source', { enum: ['ea', 'rule'] }).notNull().default('rule'),
    overall: integer('overall').notNull(),
    positionRank: integer('position_rank').notNull(),
    marketValueM: integer('market_value_m').notNull(),
    basePriceM: integer('base_price_m').notNull(),
    /** Club id (clubs.id) when the player is in one of the 20 AI squads. */
    seedClub: text('seed_club').references(() => clubs.id, { onDelete: 'set null' }),
    /** The player's real club as of the data date (any club, not only the 20). Display only. */
    clubNow: text('club_now'),
    nationality: text('nationality'),
    isActive: bool('is_active').notNull().default(true),
  },
  (t) => [index('pool_players_position_idx').on(t.position, t.overall)],
);

// ---------------------------------------------------------------------------
// Games

export const games = sqliteTable(
  'games',
  {
    id: id(),
    joinCode: text('join_code').notNull().unique(),
    name: text('name').notNull(),
    hostUserId: text('host_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: GAME_STATUSES }).notNull().default('lobby'),
    settings: json<Record<string, unknown>>('settings').notNull(),
    seed: integer('seed'),
    nominationOrder: json<string[]>('nomination_order'),
    nominationIndex: integer('nomination_index').notNull().default(0),
    /** Live lot, if any. No foreign key: games and lots would reference each other. */
    currentLotId: text('current_lot_id'),
    nominationDeadline: integer('nomination_deadline', { mode: 'number' }),
    lotDeadline: integer('lot_deadline', { mode: 'number' }),
    countdownDeadline: integer('countdown_deadline', { mode: 'number' }),
    pausedRemainingMs: integer('paused_remaining_ms'),
    pausedTimer: text('paused_timer', { enum: ['nomination', 'lot', 'countdown'] }),
    pausedByUserId: text('paused_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    poolSummary: json<Record<string, unknown>>('pool_summary'),
    strengthSnapshot: json<Record<string, unknown>>('strength_snapshot'),
    aiClubIds: json<string[]>('ai_club_ids'),
    playbackState: json<Record<string, unknown>>('playback_state'),
    /** First time the game reached completed; its official results are published then (game_results). */
    completedAt: integer('completed_at', { mode: 'number' }),
    /** Join code of the rematch lobby, once the host starts one. */
    rematchCode: text('rematch_code'),
    /** Admin Test Auction game: all bots, never published to results or history. */
    isTest: bool('is_test').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [index('games_status_idx').on(t.status)],
);

export const participants = sqliteTable(
  'participants',
  {
    id: id(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    teamName: text('team_name'),
    color: text('color'),
    monogram: text('monogram'),
    formation: text('formation'),
    budgetRemainingM: integer('budget_remaining_m').notNull().default(0),
    isReady: bool('is_ready').notNull().default(false),
    isBot: bool('is_bot').notNull().default(false),
    botLevel: text('bot_level', { enum: ['easy', 'medium', 'hard'] }),
    isConnected: bool('is_connected').notNull().default(false),
    isSpectator: bool('is_spectator').notNull().default(false),
    disconnectedAt: integer('disconnected_at', { mode: 'number' }),
    /** Who runs the team during the auction: its manager, a bot (takeover) or auto-nominate only. */
    control: text('control', { enum: ['human', 'bot', 'auto'] }).notNull().default('human'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('participants_game_team_name_uq').on(t.gameId, t.teamName),
    index('participants_user_idx').on(t.userId),
  ],
);

export const gamePool = sqliteTable(
  'game_pool',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    poolPlayerId: text('pool_player_id')
      .notNull()
      .references(() => poolPlayers.id),
    status: text('status', { enum: ['available', 'live', 'sold', 'unsold'] })
      .notNull()
      .default('available'),
    soldToParticipantId: text('sold_to_participant_id').references(() => participants.id, { onDelete: 'set null' }),
    priceM: integer('price_m'),
    /** Frozen copy of the player row (name, positions, overall, prices) at auction start. */
    snapshot: json<Record<string, unknown>>('snapshot').notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.poolPlayerId] })],
);

export const lots = sqliteTable(
  'lots',
  {
    id: id(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    poolPlayerId: text('pool_player_id')
      .notNull()
      .references(() => poolPlayers.id),
    nominatorId: text('nominator_id')
      .notNull()
      .references(() => participants.id),
    openingBidM: integer('opening_bid_m').notNull(),
    currentBidM: integer('current_bid_m').notNull(),
    leaderParticipantId: text('leader_participant_id').references(() => participants.id),
    status: text('status', { enum: ['live', 'sold', 'void'] })
      .notNull()
      .default('live'),
    finalPriceM: integer('final_price_m'),
    startedAt: integer('started_at', { mode: 'number' }).notNull(),
    endedAt: integer('ended_at', { mode: 'number' }),
    autoNominated: bool('auto_nominated').notNull().default(false),
  },
  (t) => [uniqueIndex('lots_game_sequence_uq').on(t.gameId, t.sequence)],
);

export const bids = sqliteTable(
  'bids',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    amountM: integer('amount_m').notNull(),
    createdAt: createdAt(),
    isBot: bool('is_bot').notNull().default(false),
  },
  (t) => [index('bids_lot_idx').on(t.lotId)],
);

export const lineupSlots = sqliteTable(
  'lineup_slots',
  {
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    slotKey: text('slot_key').notNull(),
    poolPlayerId: text('pool_player_id').references(() => poolPlayers.id),
    priceM: integer('price_m'),
    lotId: text('lot_id').references(() => lots.id, { onDelete: 'set null' }),
    autoFilled: bool('auto_filled').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.participantId, t.slotKey] })],
);

export const watchlist = sqliteTable(
  'watchlist',
  {
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    poolPlayerId: text('pool_player_id')
      .notNull()
      .references(() => poolPlayers.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.participantId, t.poolPlayerId] })],
);

// ---------------------------------------------------------------------------
// Seasons

export const seasons = sqliteTable(
  'seasons',
  {
    id: id(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    seed: integer('seed').notNull(),
    status: text('status', { enum: ['pending', 'simulated', 'failed'] })
      .notNull()
      .default('pending'),
    parametersSnapshot: json<Record<string, unknown>>('parameters_snapshot').notNull(),
    championSeasonTeamId: text('champion_season_team_id'),
    /** Awards worked out from the stored stats, saved the first time they are asked for. */
    awards: json<Record<string, unknown>>('awards'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('seasons_game_number_uq').on(t.gameId, t.seasonNumber)],
);

export const seasonTeams = sqliteTable(
  'season_teams',
  {
    id: id(),
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['human', 'bot', 'ai'] }).notNull(),
    participantId: text('participant_id').references(() => participants.id, { onDelete: 'set null' }),
    clubId: text('club_id').references(() => clubs.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    primaryColor: text('primary_color').notNull(),
    secondaryColor: text('secondary_color').notNull(),
    lineup: json<Record<string, unknown>>('lineup').notNull(),
    formation: text('formation').notNull(),
    attackRating: real('attack_rating').notNull(),
    defenseRating: real('defense_rating').notNull(),
    chemistryBonus: real('chemistry_bonus').notNull().default(0),
  },
  (t) => [index('season_teams_season_idx').on(t.seasonId)],
);

export const fixtures = sqliteTable(
  'fixtures',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    matchday: integer('matchday').notNull(),
    homeTeamId: text('home_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
    awayTeamId: text('away_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
    homeGoals: integer('home_goals'),
    awayGoals: integer('away_goals'),
  },
  (t) => [index('fixtures_season_matchday_idx').on(t.seasonId, t.matchday)],
);

export const matchEvents = sqliteTable(
  'match_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fixtureId: integer('fixture_id')
      .notNull()
      .references(() => fixtures.id, { onDelete: 'cascade' }),
    minute: integer('minute').notNull(),
    type: text('type', { enum: ['goal', 'assist', 'yellow', 'red'] }).notNull(),
    playerRef: text('player_ref').notNull(),
    seasonTeamId: text('season_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
  },
  (t) => [index('match_events_fixture_idx').on(t.fixtureId)],
);

export const standingRows = sqliteTable(
  'standing_rows',
  {
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    matchday: integer('matchday').notNull(),
    seasonTeamId: text('season_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
    played: integer('played').notNull(),
    won: integer('won').notNull(),
    drawn: integer('drawn').notNull(),
    lost: integer('lost').notNull(),
    goalsFor: integer('goals_for').notNull(),
    goalsAgainst: integer('goals_against').notNull(),
    goalDifference: integer('goal_difference').notNull(),
    points: integer('points').notNull(),
    position: integer('position').notNull(),
    form: text('form').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.matchday, t.seasonTeamId] })],
);

export const playerSeasonStats = sqliteTable(
  'player_season_stats',
  {
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    playerRef: text('player_ref').notNull(),
    seasonTeamId: text('season_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
    appearances: integer('appearances').notNull().default(0),
    goals: integer('goals').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    cleanSheets: integer('clean_sheets').notNull().default(0),
    yellows: integer('yellows').notNull().default(0),
    reds: integer('reds').notNull().default(0),
    ratingSum: real('rating_sum').notNull().default(0),
    avgRating: real('avg_rating').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.playerRef] })],
);

// ---------------------------------------------------------------------------
// Settings, audit, chat

// Official results: one row per auction team of a completed game (season 1), for profiles,
// the leaderboard, the Hall of Fame and the record book.
export const gameResults = sqliteTable(
  'game_results',
  {
    id: id(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    seasonTeamId: text('season_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    isBot: bool('is_bot').notNull().default(false),
    teamName: text('team_name').notNull(),
    color: text('color').notNull(),
    monogram: text('monogram').notNull(),
    position: integer('position').notNull(),
    points: integer('points').notNull(),
    won: integer('won').notNull(),
    drawn: integer('drawn').notNull(),
    lost: integer('lost').notNull(),
    goalsFor: integer('goals_for').notNull(),
    goalsAgainst: integer('goals_against').notNull(),
    goalDifference: integer('goal_difference').notNull(),
    preRank: integer('pre_rank').notNull(),
    grade: text('grade').notNull(),
    gradeScore: real('grade_score').notNull(),
    spentM: integer('spent_m').notNull(),
    budgetM: integer('budget_m').notNull(),
    champion: bool('champion').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('game_results_game_participant_uq').on(t.gameId, t.participantId),
    index('game_results_user_idx').on(t.userId),
  ],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
    gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
    details: json<Record<string, unknown>>('details'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt), index('audit_log_game_idx').on(t.gameId)],
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('chat_messages_game_idx').on(t.gameId, t.createdAt)],
);
