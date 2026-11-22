/**
 * Postgres mirror of schema.ts (section 3: "schema must also work on Postgres via DATABASE_URL").
 * Same tables, columns, keys and indexes; only the column types are Postgres-native.
 * test/schema.test.ts fails if the two drift apart.
 */
import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  boolean,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { GAME_STATUSES } from './enums';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const ms = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () =>
  ms('created_at')
    .notNull()
    .$defaultFn(() => Date.now());
const serialId = () => integer('id').primaryKey().generatedByDefaultAsIdentity();
const json = <T>(name: string) => jsonb(name).$type<T>();

export const users = pgTable('users', {
  id: id(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  isGuest: boolean('is_guest').notNull().default(false),
  banned: boolean('banned').notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ms('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const clubs = pgTable('clubs', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  shortName: text('short_name').notNull(),
  country: text('country').notNull(),
  leagueName: text('league_name').notNull(),
  primaryColor: text('primary_color').notNull(),
  secondaryColor: text('secondary_color').notNull(),
  monogram: text('monogram'),
  strengthRating: doublePrecision('strength_rating'),
  strengthOverride: doublePrecision('strength_override'),
  notes: text('notes'),
});

export const seedPlayers = pgTable(
  'seed_players',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    primaryPosition: text('primary_position').notNull(),
    altPositions: json<string[]>('alt_positions').notNull().default(sql`'[]'::jsonb`),
    overall: integer('overall').notNull(),
    nationality: text('nationality'),
  },
  (t) => [index('seed_players_club_idx').on(t.clubId)],
);

export const poolPlayers = pgTable(
  'pool_players',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    position: text('position').notNull(),
    altPositions: json<string[]>('alt_positions').notNull().default(sql`'[]'::jsonb`),
    altSource: text('alt_source', { enum: ['ea', 'rule'] }).notNull().default('rule'),
    overall: integer('overall').notNull(),
    positionRank: integer('position_rank').notNull(),
    marketValueM: integer('market_value_m').notNull(),
    basePriceM: integer('base_price_m').notNull(),
    seedClub: text('seed_club').references(() => clubs.id, { onDelete: 'set null' }),
    clubNow: text('club_now'),
    nationality: text('nationality'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('pool_players_position_idx').on(t.position, t.overall)],
);

export const games = pgTable(
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
    seed: bigint('seed', { mode: 'number' }),
    nominationOrder: json<string[]>('nomination_order'),
    nominationIndex: integer('nomination_index').notNull().default(0),
    currentLotId: text('current_lot_id'),
    nominationDeadline: ms('nomination_deadline'),
    lotDeadline: ms('lot_deadline'),
    countdownDeadline: ms('countdown_deadline'),
    pausedRemainingMs: integer('paused_remaining_ms'),
    pausedTimer: text('paused_timer', { enum: ['nomination', 'lot', 'countdown'] }),
    pausedByUserId: text('paused_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    poolSummary: json<Record<string, unknown>>('pool_summary'),
    strengthSnapshot: json<Record<string, unknown>>('strength_snapshot'),
    aiClubIds: json<string[]>('ai_club_ids'),
    playbackState: json<Record<string, unknown>>('playback_state'),
    createdAt: createdAt(),
    updatedAt: ms('updated_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [index('games_status_idx').on(t.status)],
);

export const participants = pgTable(
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
    isReady: boolean('is_ready').notNull().default(false),
    isBot: boolean('is_bot').notNull().default(false),
    botLevel: text('bot_level', { enum: ['easy', 'medium', 'hard'] }),
    isConnected: boolean('is_connected').notNull().default(false),
    isSpectator: boolean('is_spectator').notNull().default(false),
    disconnectedAt: ms('disconnected_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('participants_game_team_name_uq').on(t.gameId, t.teamName),
    index('participants_user_idx').on(t.userId),
  ],
);

export const gamePool = pgTable(
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
    snapshot: json<Record<string, unknown>>('snapshot').notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.poolPlayerId] })],
);

export const lots = pgTable(
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
    startedAt: ms('started_at').notNull(),
    endedAt: ms('ended_at'),
    autoNominated: boolean('auto_nominated').notNull().default(false),
  },
  (t) => [uniqueIndex('lots_game_sequence_uq').on(t.gameId, t.sequence)],
);

export const bids = pgTable(
  'bids',
  {
    id: serialId(),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    amountM: integer('amount_m').notNull(),
    createdAt: createdAt(),
    isBot: boolean('is_bot').notNull().default(false),
  },
  (t) => [index('bids_lot_idx').on(t.lotId)],
);

export const lineupSlots = pgTable(
  'lineup_slots',
  {
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    slotKey: text('slot_key').notNull(),
    poolPlayerId: text('pool_player_id').references(() => poolPlayers.id),
    priceM: integer('price_m'),
    lotId: text('lot_id').references(() => lots.id, { onDelete: 'set null' }),
    autoFilled: boolean('auto_filled').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.participantId, t.slotKey] })],
);

export const watchlist = pgTable(
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

export const seasons = pgTable(
  'seasons',
  {
    id: id(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    seed: bigint('seed', { mode: 'number' }).notNull(),
    status: text('status', { enum: ['pending', 'simulated', 'failed'] })
      .notNull()
      .default('pending'),
    parametersSnapshot: json<Record<string, unknown>>('parameters_snapshot').notNull(),
    championSeasonTeamId: text('champion_season_team_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('seasons_game_number_uq').on(t.gameId, t.seasonNumber)],
);

export const seasonTeams = pgTable(
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
    attackRating: doublePrecision('attack_rating').notNull(),
    defenseRating: doublePrecision('defense_rating').notNull(),
    chemistryBonus: doublePrecision('chemistry_bonus').notNull().default(0),
  },
  (t) => [index('season_teams_season_idx').on(t.seasonId)],
);

export const fixtures = pgTable(
  'fixtures',
  {
    id: serialId(),
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

export const matchEvents = pgTable(
  'match_events',
  {
    id: serialId(),
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

export const standingRows = pgTable(
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

export const playerSeasonStats = pgTable(
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
    ratingSum: doublePrecision('rating_sum').notNull().default(0),
    avgRating: doublePrecision('avg_rating').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.playerRef] })],
);

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
  updatedAt: ms('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: serialId(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
    gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
    details: json<Record<string, unknown>>('details'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt), index('audit_log_game_idx').on(t.gameId)],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: serialId(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('chat_messages_game_idx').on(t.gameId, t.createdAt)],
);
