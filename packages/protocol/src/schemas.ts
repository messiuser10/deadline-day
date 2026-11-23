/** zod schemas for every request body. The server validates with these; the web app reuses them for forms. */
import { z } from 'zod';
import { FORMATION_IDS, MAX_TEAMS, MIN_TEAMS } from '@deadline-day/engine';
import { PLAYBACK_SPEEDS, SEASON_MATCHDAYS } from './playback';

const collapse = (s: string) => s.trim().replace(/\s+/g, ' ');

export const formationIdSchema = z.enum(FORMATION_IDS);

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[A-Za-z0-9_]+$/, 'Use letters, digits and underscores only')
  .transform((s) => s.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const displayNameSchema = z
  .string()
  .transform(collapse)
  .pipe(z.string().min(2, 'Name must be at least 2 characters').max(24, 'Name must be at most 24 characters'));

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(40).transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const guestSchema = z.object({ displayName: displayNameSchema });
export type GuestInput = z.input<typeof guestSchema>;

export const teamNameSchema = z
  .string()
  .transform(collapse)
  .pipe(
    z
      .string()
      .min(3, 'Team name must be at least 3 characters')
      .max(24, 'Team name must be at most 24 characters')
      .regex(/^[\p{L}\p{N} .'&-]+$/u, "Use letters, digits, spaces and . ' & - only"),
  );

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be #RRGGBB')
  .transform((s) => s.toLowerCase());

export const monogramSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{1,3}$/, 'Monogram is 1 to 3 letters or digits'));

export const teamSchema = z.object({
  teamName: teamNameSchema,
  color: colorSchema,
  monogram: monogramSchema,
  formation: formationIdSchema,
});
export type TeamInput = z.input<typeof teamSchema>;

export const teamPatchSchema = teamSchema.partial().extend({ isReady: z.boolean().optional() });
export type TeamPatchInput = z.input<typeof teamPatchSchema>;

const int = () => z.number().int();

export const gameSettingsSchema = z.object({
  maxTeams: int().min(MIN_TEAMS).max(MAX_TEAMS),
  budgetM: int().min(1),
  nominationTimerS: int().min(1),
  lotTimerS: int().min(1),
  antiSnipeS: int().min(0),
  minIncrementM: int().min(1),
  extraMin: int().min(0),
  extraPct: z.number().min(0).max(1),
  removeBoughtFromAi: z.boolean(),
  botsAllowed: z.boolean(),
  playbackMode: z.enum(['synchronized', 'own_pace']),
  autoStartSeason: z.boolean(),
  formationRule: z.enum(['each', 'forced']),
  forcedFormation: formationIdSchema.nullable(),
  visibility: z.enum(['private', 'public']),
});
export type GameSettings = z.infer<typeof gameSettingsSchema>;

export const gameNameSchema = z
  .string()
  .transform(collapse)
  .pipe(z.string().min(3, 'Game name must be at least 3 characters').max(40, 'Game name must be at most 40 characters'));

export const createGameSchema = z.object({
  name: gameNameSchema,
  settings: gameSettingsSchema.partial().default({}),
  team: teamSchema,
});
export type CreateGameInput = z.input<typeof createGameSchema>;

export const soloGameSchema = z.object({ team: teamSchema });
export type SoloGameInput = z.input<typeof soloGameSchema>;

export const settingsPatchSchema = z.object({
  name: gameNameSchema.optional(),
  settings: gameSettingsSchema.partial().default({}),
});
export type SettingsPatchInput = z.input<typeof settingsPatchSchema>;

export const botLevelSchema = z.enum(['easy', 'medium', 'hard']);

export const addBotSchema = z.object({
  level: botLevelSchema.default('medium'),
  formation: formationIdSchema.optional(),
});
export type AddBotInput = z.input<typeof addBotSchema>;

export const botPatchSchema = z.object({
  level: botLevelSchema.optional(),
  formation: formationIdSchema.optional(),
});
export type BotPatchInput = z.input<typeof botPatchSchema>;

export const nominationOrderSchema = z.object({ order: z.array(z.string().min(1)).min(1).max(MAX_TEAMS) });
export type NominationOrderInput = z.input<typeof nominationOrderSchema>;

export const transferHostSchema = z.object({ participantId: z.string().min(1) });

export const startSchema = z.object({ force: z.boolean().default(false) });
export type StartInput = z.input<typeof startSchema>;

export const chatSchema = z.object({
  body: z
    .string()
    .transform(collapse)
    .pipe(z.string().min(1, 'Message is empty').max(280, 'Message is at most 280 characters')),
});
export type ChatInput = z.input<typeof chatSchema>;

// Auction ---------------------------------------------------------------------

const playerIdSchema = z.string().min(1).max(64);
/** Amounts are numbers here; the rules return NOT_WHOLE_NUMBER for fractions with a clear message. */
const amountSchema = z.number().finite().min(0).max(100_000);

export const nominateSchema = z.object({ playerId: playerIdSchema, openingBidM: amountSchema });
export type NominateInput = z.input<typeof nominateSchema>;

export const bidSchema = z.object({
  amountM: amountSchema,
  /** The price the bidder's screen showed: a bid that lost a race gets OUTBID instead of BID_TOO_LOW. */
  seenBidM: amountSchema.optional(),
  /** The lot the bidder meant; a bid for a lot that has closed is rejected with LOT_CLOSED. */
  lotSequence: z.number().int().min(1).optional(),
});
export type BidInput = z.input<typeof bidSchema>;

export const swapSlotsSchema = z.object({ slotA: z.string().min(1).max(8), slotB: z.string().min(1).max(8) });
export type SwapSlotsInput = z.input<typeof swapSlotsSchema>;

export const teamControlSchema = z.object({
  mode: z.enum(['human', 'bot', 'auto']),
  level: botLevelSchema.optional(),
});
export type TeamControlInput = z.input<typeof teamControlSchema>;

export const joinCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{6}$/, 'A game code is 6 letters or digits'));

export const adminUserPatchSchema = z
  .object({ role: z.enum(['admin', 'user']).optional(), banned: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.banned !== undefined, 'Nothing to change');

export const playbackActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('play') }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('speed'), speed: z.enum(PLAYBACK_SPEEDS) }),
  /** Show matchday N at full time (0 = before kick-off of matchday 1). */
  z.object({ action: z.literal('seek'), matchday: int().min(0).max(SEASON_MATCHDAYS) }),
  z.object({ action: z.literal('end') }),
]);
export type PlaybackAction = z.input<typeof playbackActionSchema>;

export const seasonQuerySchema = z.object({ number: z.coerce.number().int().min(1).max(10_000).optional() });

export const multiSeasonQuerySchema = z.object({
  seasons: z.coerce.number().int().min(2).max(10),
  run: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type MultiSeasonQuery = z.input<typeof multiSeasonQuerySchema>;

export const EXPORT_TABLES = ['table', 'fixtures', 'players', 'grades'] as const;
export const exportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  table: z.enum(EXPORT_TABLES).default('table'),
  number: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type ExportQuery = z.output<typeof exportQuerySchema>;

export const hallOfFameQuerySchema = z.object({ before: z.coerce.number().int().positive().optional() });
