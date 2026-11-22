/** zod schemas for every request body. The server validates with these; the web app reuses them for forms. */
import { z } from 'zod';
import { FORMATION_IDS, MAX_TEAMS, MIN_TEAMS } from '@deadline-day/engine';

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

export const joinCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{6}$/, 'A game code is 6 letters or digits'));

export const adminUserPatchSchema = z
  .object({ role: z.enum(['admin', 'user']).optional(), banned: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.banned !== undefined, 'Nothing to change');
