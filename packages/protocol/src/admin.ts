/**
 * Admin panel contract (section 11): request schemas and the views the admin API returns.
 * Every admin route re-checks the admin role on the server; these schemas only shape the input.
 */
import { z } from 'zod';
import {
  FORMATION_IDS,
  GROUPS,
  MAX_TEAMS,
  MIN_TEAMS,
  POSITIONS,
  type FormationId,
  type Group,
  type PoolParams,
  type Position,
  type PriceParams,
  type SimParams,
  type SlotCompatibility,
} from '@deadline-day/engine';
import type { GameLimits } from './limits';
import { colorSchema, formationIdSchema, gameSettingsSchema, joinCodeSchema, monogramSchema, type GameSettings } from './schemas';
import type { GameStatus, Role, TableBand } from './views';

const int = () => z.number().int();
const collapse = (s: string) => s.trim().replace(/\s+/g, ' ');
const optionalText = (max: number) =>
  z
    .string()
    .transform(collapse)
    .pipe(z.string().max(max))
    .transform((s) => (s === '' ? null : s))
    .nullable();

// ---------------------------------------------------------------------------
// App settings

export type AiClubSelectionMethod = 'top_by_strength' | 'manual' | 'random';

/** Every app_settings key with its value type. Stored values are merged over the defaults on read. */
export interface AppSettings {
  league_name: string;
  slot_compatibility: SlotCompatibility;
  formations_enabled: FormationId[];
  /** Edited only through the Reprice tool, which also reprices every pool player. */
  price_curve: PriceParams;
  /** Mirrors game_defaults.extraMin / extraPct. */
  pool_params: PoolParams;
  game_defaults: GameSettings;
  game_limits: GameLimits;
  /** Mirrors game_defaults.removeBoughtFromAi. */
  remove_bought_from_ai: boolean;
  /** Section 9 simulation parameters, snapshotted into every season. */
  sim_params: SimParams;
  /** Final-table colour bands (section 10). */
  table_bands: TableBand[];
  ai_club_selection: { method: AiClubSelectionMethod; manualClubIds: string[] };
  public_lobbies_enabled: boolean;
  registrations_open: boolean;
  profanity_words: string[];
  maintenance_banner: { message: string | null };
}

const range = (lo: number, hi: number, isInt = true) =>
  z
    .tuple([isInt ? int().min(lo).max(hi) : z.number().min(lo).max(hi), isInt ? int().min(lo).max(hi) : z.number().min(lo).max(hi)])
    .refine(([a, b]) => a <= b, 'The minimum must not be above the maximum');

export const gameLimitsSchema = z.object({
  budgetM: range(50, 20000),
  nominationTimerS: range(5, 600),
  lotTimerS: range(3, 600),
  antiSnipeS: range(0, 120),
  minIncrementM: range(1, 500),
  extraMin: range(0, 20),
  extraPct: range(0, 1, false),
});

export const tiebreakerSchema = z.enum(['goal_difference', 'goals_for', 'head_to_head']);

export const simParamsSchema = z.object({
  baseGoals: z.number().min(0.3).max(4),
  homeAdvantage: z.number().min(0.7).max(1.6),
  sensitivity: z.number().min(0).max(0.5),
  chaos: z.number().min(0).max(1),
  outOfPositionPenalty: int().min(0).max(40),
  reserveRating: int().min(40).max(90),
  chemistry: z.boolean(),
  injuries: z.boolean(),
  points: z
    .object({ win: int().min(0).max(10), draw: int().min(0).max(10), loss: int().min(-5).max(10) })
    .refine((p) => p.win >= p.draw && p.draw >= p.loss, 'Points must go win, then draw, then loss'),
  tiebreakers: z
    .array(tiebreakerSchema)
    .max(3)
    .refine((t) => new Set(t).size === t.length, 'Each tiebreaker can appear once'),
});

export const tableBandSchema = z
  .object({
    from: int().min(1).max(20),
    to: int().min(1).max(20),
    label: z.string().transform(collapse).pipe(z.string().min(1).max(24)),
    tone: z.enum(['gold', 'green', 'blue', 'red']),
    enabled: z.boolean(),
  })
  .refine((b) => b.from <= b.to, 'A band must start at or above where it ends');

/** Validation for each editable key. price_curve and slot_compatibility are not editable here. */
export const settingValueSchemas = {
  league_name: z.string().transform(collapse).pipe(z.string().min(2).max(40)),
  formations_enabled: z
    .array(formationIdSchema)
    .min(1, 'Enable at least one formation')
    .refine((f) => new Set(f).size === f.length, 'Each formation can appear once'),
  game_defaults: gameSettingsSchema,
  game_limits: gameLimitsSchema,
  sim_params: simParamsSchema,
  table_bands: z.array(tableBandSchema).max(8),
  ai_club_selection: z.object({
    method: z.enum(['top_by_strength', 'manual', 'random']),
    manualClubIds: z.array(z.string().min(1).max(60)).max(20),
  }),
  public_lobbies_enabled: z.boolean(),
  registrations_open: z.boolean(),
  profanity_words: z
    .array(z.string().trim().toLowerCase().pipe(z.string().min(2).max(40)))
    .max(5000)
    .transform((w) => [...new Set(w)].sort()),
  maintenance_banner: z.object({ message: optionalText(200) }),
} as const;

export type EditableSettingKey = keyof typeof settingValueSchemas;
export const EDITABLE_SETTING_KEYS = Object.keys(settingValueSchemas) as EditableSettingKey[];

export const settingUpdateSchema = z.object({
  key: z.enum(EDITABLE_SETTING_KEYS as [EditableSettingKey, ...EditableSettingKey[]]),
  value: z.unknown(),
});

export interface AdminSettingsView {
  settings: AppSettings;
  defaults: AppSettings;
  formations: FormationId[];
}

// ---------------------------------------------------------------------------
// Overview

export interface HealthWarning {
  level: 'warning' | 'error';
  code: string;
  message: string;
}

export interface AdminOverview {
  counts: {
    users: number;
    registered: number;
    guests: number;
    admins: number;
    banned: number;
    activeLobbies: number;
    auctionsInProgress: number;
    seasonsSimulated: number;
    gamesCompleted: number;
    poolPlayers: number;
    activePoolPlayers: number;
  };
  recent: AuditEntryView[];
  health: HealthWarning[];
}

// ---------------------------------------------------------------------------
// Audit log

export interface AuditActorView {
  id: string;
  username: string;
  displayName: string;
}

export interface AuditEntryView {
  id: number;
  at: number;
  actor: AuditActorView | null;
  action: string;
  target: string | null;
  gameCode: string | null;
  details: Record<string, unknown> | null;
}

const epochMs = z.coerce.number().int().min(0).max(8_640_000_000_000_000);

export const auditQuerySchema = z.object({
  /** Actor username or display name (substring). */
  actor: z.string().trim().max(40).optional(),
  /** Action prefix, e.g. "game.auction" or "admin.". */
  action: z.string().trim().max(60).optional(),
  /** Game join code. */
  game: z.string().trim().toUpperCase().max(12).optional(),
  from: epochMs.optional(),
  to: epochMs.optional(),
  /** Cursor: only entries with a smaller id. */
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.input<typeof auditQuerySchema>;

export interface AuditPage {
  entries: AuditEntryView[];
  nextBefore: number | null;
}

// ---------------------------------------------------------------------------
// Pool players

export const poolIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single dashes, e.g. bukayo-saka-rw');

const altGroups = z
  .array(z.enum(GROUPS))
  .max(4)
  .refine((a) => new Set(a).size === a.length, 'Each alternate position can appear once');

const poolPlayerFields = {
  name: z.string().transform(collapse).pipe(z.string().min(2).max(60)),
  position: z.enum(GROUPS),
  altPositions: altGroups,
  altSource: z.enum(['ea', 'rule']),
  overall: int().min(40).max(99),
  /** Club id of one of the 20 AI clubs, or null. */
  seedClub: z.string().min(1).max(60).nullable(),
  clubNow: optionalText(60),
  nationality: optionalText(40),
  isActive: z.boolean(),
};

export const poolPlayerCreateSchema = z
  .object({ id: poolIdSchema, ...poolPlayerFields })
  .refine((p) => !p.altPositions.includes(p.position), { message: 'An alternate cannot be the main position', path: ['altPositions'] });
export type PoolPlayerCreate = z.input<typeof poolPlayerCreateSchema>;

export const poolPlayerPatchSchema = z
  .object(poolPlayerFields)
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change');
export type PoolPlayerPatch = z.input<typeof poolPlayerPatchSchema>;

export const poolBulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('activate'), ids: z.array(poolIdSchema).min(1).max(1000) }),
  z.object({ action: z.literal('deactivate'), ids: z.array(poolIdSchema).min(1).max(1000) }),
  z.object({ action: z.literal('delete'), ids: z.array(poolIdSchema).min(1).max(1000) }),
  z.object({ action: z.literal('set_alt_source'), ids: z.array(poolIdSchema).min(1).max(1000), altSource: z.enum(['ea', 'rule']) }),
  z.object({ action: z.literal('shift_overall'), ids: z.array(poolIdSchema).min(1).max(1000), by: int().min(-20).max(20).refine((n) => n !== 0) }),
]);
export type PoolBulkInput = z.input<typeof poolBulkSchema>;

export interface AdminPoolPlayer {
  id: string;
  name: string;
  position: Group;
  altPositions: Group[];
  altSource: 'ea' | 'rule';
  overall: number;
  positionRank: number;
  marketValueM: number;
  basePriceM: number;
  seedClub: string | null;
  clubNow: string | null;
  nationality: string | null;
  isActive: boolean;
  /** Games whose auction pool contains this player (a player in any game cannot be deleted). */
  games: number;
}

export interface AdminPoolView {
  players: AdminPoolPlayer[];
  /** Groups of ids that look like the same player (same normalized name and position). */
  duplicates: string[][];
  clubs: { id: string; name: string }[];
}

export const POOL_IMPORT_MODES = ['upsert', 'replace', 'alt_positions'] as const;
export type PoolImportMode = (typeof POOL_IMPORT_MODES)[number];

export const poolImportSchema = z.object({
  format: z.enum(['csv', 'json']),
  mode: z.enum(POOL_IMPORT_MODES),
  content: z.string().min(1).max(3_000_000),
});
export type PoolImportInput = z.input<typeof poolImportSchema>;

export interface FieldChange {
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export interface PoolImportPreview {
  mode: PoolImportMode;
  rows: number;
  added: { id: string; name: string; position: string; overall: number }[];
  changed: { id: string; name: string; changes: FieldChange[] }[];
  deactivated: { id: string; name: string }[];
  unchanged: number;
  /** Any error blocks Apply. */
  errors: string[];
  warnings: string[];
}

export const priceParamsSchema = z.object({
  anchor: z.number().min(1).max(1000),
  growth: z.number().min(1).max(1.5),
  baseFraction: z.number().min(0.05).max(1),
});

export interface RepricePreview {
  params: PriceParams;
  current: PriceParams;
  /** Market value and base price by overall, old and new. */
  curve: { overall: number; marketValueM: number; basePriceM: number; oldMarketValueM: number; oldBasePriceM: number }[];
  changedPlayers: number;
  activeMarketValueM: { before: number; after: number };
}

// ---------------------------------------------------------------------------
// Clubs and squads

export interface AdminClubView {
  id: string;
  name: string;
  shortName: string;
  country: string;
  primaryColor: string;
  secondaryColor: string;
  monogram: string;
  notes: string | null;
  strength: number;
  computedStrength: number;
  override: number | null;
  rank: number;
  xiAverage: number;
  formation: FormationId;
  squadSize: number;
}

export interface AdminClubsView {
  clubs: AdminClubView[];
  selection: AppSettings['ai_club_selection'];
}

export const clubPatchSchema = z
  .object({
    primaryColor: colorSchema,
    secondaryColor: colorSchema,
    monogram: monogramSchema,
    strengthOverride: z.number().min(0).max(100).nullable(),
    notes: optionalText(300),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change');
export type ClubPatch = z.input<typeof clubPatchSchema>;

export const squadPlayerSchema = z.object({
  name: z.string().transform(collapse).pipe(z.string().min(2).max(60)),
  position: z.enum(POSITIONS),
  altPositions: z
    .array(z.enum(POSITIONS))
    .max(4)
    .refine((a) => new Set(a).size === a.length, 'Each alternate position can appear once'),
  overall: int().min(40).max(99),
  nationality: optionalText(40),
});
export type SquadPlayerInput = z.input<typeof squadPlayerSchema>;

export interface SquadPlayerView {
  id: string;
  name: string;
  position: Position;
  altPositions: Position[];
  overall: number;
  nationality: string | null;
}

// ---------------------------------------------------------------------------
// Games

export const adminGamesQuerySchema = z.object({
  status: z.enum(['active', 'lobby', 'auctioning', 'paused', 'auction_complete', 'simulating', 'completed', 'cancelled', 'test']).optional(),
  q: z.string().trim().max(40).optional(),
  /** Cursor: games created before this time. */
  before: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export interface AdminGameRow {
  id: string;
  code: string;
  name: string;
  status: GameStatus;
  visibility: 'private' | 'public';
  isTest: boolean;
  host: AuditActorView | null;
  teams: number;
  humans: number;
  bots: number;
  seasons: number;
  seed: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AdminGamesPage {
  games: AdminGameRow[];
  nextBefore: number | null;
}

export interface AdminGameTeam {
  id: string;
  teamName: string;
  manager: string | null;
  isBot: boolean;
  control: 'human' | 'bot' | 'auto';
  isConnected: boolean;
  players: number;
  budgetRemainingM: number;
}

export interface AdminGameDetail {
  game: AdminGameRow;
  teams: AdminGameTeam[];
  /** Participant ids in nomination order. */
  order: string[];
  /** Team due to nominate next, when the auction is running. */
  onTheClock: string | null;
}

export const adminOrderSchema = z.object({ order: z.array(z.string().min(1)).min(1).max(MAX_TEAMS) });
export const adminSeedSchema = z.object({ seed: int().min(0).max(4_294_967_295).optional() });

// ---------------------------------------------------------------------------
// Simulation Lab

export interface LabTeamView {
  /** "club:<club id>" or "team:<season team id>". */
  id: string;
  name: string;
  kind: 'human' | 'bot' | 'ai';
  color: string;
  monogram: string;
  attack: number;
  defense: number;
  source: 'club' | 'game';
}

export const labTeamsQuerySchema = z.object({ game: joinCodeSchema.optional() });

export interface LabTeamsView {
  /** The 20 clubs, then the loaded game's season teams when a game is given. */
  teams: LabTeamView[];
  /** The loaded game's latest season, so the form can preselect its 20 teams and seed. */
  game: { code: string; name: string; seasonNumber: number; seed: number; teamIds: string[] } | null;
}

export const labRunSchema = z.object({
  teamIds: z
    .array(z.string().min(1).max(120))
    .length(20, 'Pick exactly 20 teams')
    .refine((ids) => new Set(ids).size === ids.length, 'Pick each team once'),
  seed: int().min(0).max(4_294_967_295),
  params: simParamsSchema.partial().default({}),
  runs: int().min(1).max(1000).default(1),
});
export type LabRunInput = z.input<typeof labRunSchema>;

export interface Distribution {
  mean: number;
  min: number;
  max: number;
  /** Equal-width bins from `from`, each `width` wide. */
  bins: { from: number; to: number; count: number }[];
}

export interface LabTeamResult {
  id: string;
  name: string;
  avgPoints: number;
  avgPosition: number;
  titleChance: number;
  top4Chance: number;
  bottom3Chance: number;
  /** Last run's final row (a single season shows this as its table). */
  last: { position: number; points: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number };
}

export interface LabResult {
  runs: number;
  seed: number;
  params: SimParams;
  /** Per run (season average) when runs > 1, per match total goals when runs = 1. */
  goals: Distribution;
  goalsPerMatch: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  /** Champion points minus bottom team points, per run. */
  pointsSpread: Distribution;
  championPoints: Distribution;
  teams: LabTeamResult[];
  ms: number;
}

export const testAuctionSchema = z.object({
  teams: int().min(MIN_TEAMS).max(MAX_TEAMS),
  botLevel: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
  formation: z.enum([...FORMATION_IDS, 'mixed']).default('mixed'),
});
export type TestAuctionInput = z.input<typeof testAuctionSchema>;

export interface TestAuctionResult {
  code: string;
  teams: number;
  poolSize: number;
  unsold: number;
  lots: number;
  bids: number;
  totalSpentM: number;
  biggest: { name: string; priceM: number; teamName: string } | null;
  smallest: { name: string; priceM: number; teamName: string } | null;
  championName: string | null;
  ms: number;
}

// ---------------------------------------------------------------------------
// Users

export const adminUsersQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  filter: z.enum(['all', 'registered', 'guests', 'admins', 'banned']).default('all'),
});

export interface AdminUserRow {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
  banned: boolean;
  createdAt: number;
  games: number;
}

export interface AdminUserGame {
  code: string;
  name: string;
  status: GameStatus;
  teamName: string | null;
  isHost: boolean;
  createdAt: number;
}

export interface AdminUserDetail {
  user: AdminUserRow;
  games: AdminUserGame[];
}

export const deleteUserSchema = z.object({
  /** Must equal the user's username, as a typed confirmation. */
  confirm: z.string().min(1).max(40),
});
