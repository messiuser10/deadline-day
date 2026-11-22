/**
 * Game lifecycle up to the start of the auction (section 7): create, join, lobby edits, host controls,
 * the live pool preview, snapshots, and the start transaction. Every mutation is synchronous SQLite
 * work, so requests for one game never interleave.
 */
import { and, asc, desc, eq, inArray, isNotNull, max } from 'drizzle-orm';
import {
  FORMATIONS,
  LEAGUE_SIZE,
  buildAuctionPool,
  defaultMonogram,
  randomSeed,
  type FormationId,
} from '@deadline-day/engine';
import {
  BOT_TEAM_NAMES,
  CHAT_HISTORY,
  TEAM_COLORS,
  gameSettingsSchema,
  joinCodeSchema,
  type AddBotInput,
  type AiClubsPreview,
  type BotPatchInput,
  type ChatMessageView,
  type GameSettings,
  type GameSnapshot,
  type GameView,
  type LobbyUpdate,
  type ParticipantView,
  type PoolPreview,
  type PublicLobby,
  type StartBlocker,
  type TeamInput,
  type TeamPatchInput,
} from '@deadline-day/protocol';
import { audit } from '../audit';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { chatMessages, clubs, gamePool, games, lineupSlots, participants, users } from '../db/schema';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../errors';
import { DEFAULT_GAME_SETTINGS, type AppSettings } from '../settings/defaults';
import { readAppSettings } from '../settings/store';
import { findProfanity, maskProfanity } from '../text/profanity';
import { cryptoShuffle, randomJoinCode } from './codes';
import { selectAiClubIds, type RankedClub, type ReferenceData } from './reference';
import type { Timers } from './timers';

export type GameRow = typeof games.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;

/** How the service pushes changes to connected clients (implemented by the Socket.IO hub). */
export interface Broadcaster {
  lobbyUpdate(gameId: string, update: LobbyUpdate): void;
  snapshot(gameId: string, snapshot: GameSnapshot): void;
  presence(gameId: string, p: { participantId: string; isConnected: boolean }): void;
  chat(gameId: string, message: ChatMessageView): void;
  kicked(userId: string, gameId: string, code: string): void;
  notice(gameId: string, notice: { code: string; level: 'info' | 'error'; message: string }): void;
}

const SILENT: Broadcaster = {
  lobbyUpdate: () => {},
  snapshot: () => {},
  presence: () => {},
  chat: () => {},
  kicked: () => {},
  notice: () => {},
};

export interface StrengthSnapshot {
  computedAt: number;
  method: AiClubsPreview['method'];
  clubs: RankedClub[];
}

interface ValidTeam {
  teamName: string;
  color: string;
  monogram: string;
  formation: FormationId;
}

export interface GameServiceOptions {
  db: Db;
  reference: ReferenceData;
  timers: Timers;
  startCountdownMs: number;
  chatMinIntervalMs?: number;
}

const startTimerKey = (gameId: string) => `start:${gameId}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class GameService {
  broadcaster: Broadcaster = SILENT;
  private readonly db: Db;
  private readonly lastChat = new Map<string, number>();

  constructor(private readonly opts: GameServiceOptions) {
    this.db = opts.db;
  }

  // -------------------------------------------------------------------------
  // Lookups

  appSettings(): AppSettings {
    return readAppSettings(this.db);
  }

  findGame(code: string): GameRow {
    const parsed = joinCodeSchema.safeParse(code);
    const game = parsed.success ? this.db.select().from(games).where(eq(games.joinCode, parsed.data)).get() : undefined;
    if (!game) throw notFound('GAME_NOT_FOUND', 'No game with that code');
    return game;
  }

  private gameById(id: string): GameRow {
    const game = this.db.select().from(games).where(eq(games.id, id)).get();
    if (!game) throw notFound('GAME_NOT_FOUND', 'No such game');
    return game;
  }

  gameSettings(game: GameRow): GameSettings {
    return gameSettingsSchema.parse({ ...DEFAULT_GAME_SETTINGS, ...game.settings });
  }

  /** Teams (non-spectator participants) in join order. */
  teams(gameId: string): ParticipantRow[] {
    return this.db
      .select()
      .from(participants)
      .where(and(eq(participants.gameId, gameId), eq(participants.isSpectator, false)))
      .orderBy(asc(participants.createdAt), asc(participants.id))
      .all();
  }

  /** A join time strictly after every team already in the game, so join order never ties. */
  private nextJoinTime(gameId: string): number {
    const last = this.db.select({ t: max(participants.createdAt) }).from(participants).where(eq(participants.gameId, gameId)).get()?.t ?? 0;
    return Math.max(Date.now(), last + 1);
  }

  private participantOf(gameId: string, userId: string): ParticipantRow | undefined {
    return this.db
      .select()
      .from(participants)
      .where(and(eq(participants.gameId, gameId), eq(participants.userId, userId)))
      .get();
  }

  private requireParticipant(game: GameRow, user: UserRow): ParticipantRow {
    const p = this.participantOf(game.id, user.id);
    if (!p) throw forbidden('NOT_IN_GAME', 'You are not in this game');
    return p;
  }

  private requireHost(game: GameRow, user: UserRow): void {
    if (game.hostUserId !== user.id && user.role !== 'admin') throw forbidden('HOST_ONLY', 'Only the host can do that');
  }

  private requireLobby(game: GameRow): void {
    if (game.status !== 'lobby') throw conflict('NOT_IN_LOBBY', 'The auction has already started');
    if (game.countdownDeadline !== null) throw conflict('COUNTDOWN_RUNNING', 'The auction is about to start');
  }

  // -------------------------------------------------------------------------
  // Validation

  private checkClean(value: string, what: string, app: AppSettings): void {
    if (findProfanity(value, app.profanity_words)) throw badRequest('PROFANITY', `Please choose a different ${what}`);
  }

  validateSettings(settings: GameSettings, app: AppSettings): GameSettings {
    const s = gameSettingsSchema.parse(settings);
    const limits = app.game_limits;
    const labels: Record<keyof typeof limits, string> = {
      budgetM: 'Budget',
      nominationTimerS: 'Nomination timer',
      lotTimerS: 'Lot timer',
      antiSnipeS: 'Anti-snipe reset',
      minIncrementM: 'Minimum increment',
      extraMin: 'extra_min',
      extraPct: 'extra_pct',
    };
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      const [lo, hi] = limits[key];
      if (s[key] < lo || s[key] > hi) throw badRequest('SETTING_OUT_OF_RANGE', `${labels[key]} must be between ${lo} and ${hi}`);
    }
    if (s.formationRule === 'forced') {
      if (!s.forcedFormation) throw badRequest('FORCED_FORMATION_REQUIRED', 'Pick the formation every team must use');
      if (!app.formations_enabled.includes(s.forcedFormation)) throw badRequest('FORMATION_DISABLED', `${s.forcedFormation} is not enabled`);
    }
    if (s.visibility === 'public' && !app.public_lobbies_enabled) {
      throw badRequest('PUBLIC_LOBBIES_DISABLED', 'Public lobbies are switched off; make the game private');
    }
    return s;
  }

  private resolveFormation(requested: FormationId, s: GameSettings, app: AppSettings): FormationId {
    if (s.formationRule === 'forced' && s.forcedFormation) return s.forcedFormation;
    if (!app.formations_enabled.includes(requested)) throw badRequest('FORMATION_DISABLED', `${requested} is not enabled`);
    return requested;
  }

  private checkTeamName(gameId: string, name: string, exceptId: string | null, app: AppSettings): void {
    this.checkClean(name, 'team name', app);
    const taken = this.teams(gameId).some((t) => t.id !== exceptId && t.teamName?.toLowerCase() === name.toLowerCase());
    if (taken) throw conflict('TEAM_NAME_TAKEN', 'Another team already has that name');
  }

  private validTeam(game: GameRow, input: TeamInput & { formation: FormationId }, exceptId: string | null): ValidTeam {
    const app = this.appSettings();
    this.checkTeamName(game.id, input.teamName, exceptId, app);
    this.checkClean(input.monogram, 'monogram', app);
    return {
      teamName: input.teamName,
      color: input.color,
      monogram: input.monogram,
      formation: this.resolveFormation(input.formation, this.gameSettings(game), app),
    };
  }

  // -------------------------------------------------------------------------
  // Snapshots

  private participantViews(game: GameRow, teams: ParticipantRow[]): ParticipantView[] {
    const userIds = teams.map((t) => t.userId).filter((id): id is string => id !== null);
    const people = new Map(
      (userIds.length ? this.db.select().from(users).where(inArray(users.id, userIds)).all() : []).map((u) => [u.id, u]),
    );
    return teams.map((t) => {
      const u = t.userId ? people.get(t.userId) : undefined;
      return {
        id: t.id,
        userId: t.userId,
        managerName: t.isBot ? `Bot (${capitalize(t.botLevel ?? 'medium')})` : (u?.displayName ?? 'Unknown'),
        teamName: t.teamName ?? 'Unnamed',
        color: t.color ?? TEAM_COLORS[0],
        monogram: t.monogram ?? 'FC',
        formation: (t.formation ?? '4-3-3') as FormationId,
        isReady: t.isBot || t.isReady,
        isBot: t.isBot,
        botLevel: t.botLevel,
        isConnected: t.isBot || t.isConnected,
        isHost: t.userId !== null && t.userId === game.hostUserId,
        isGuest: u?.isGuest ?? false,
        budgetRemainingM: t.budgetRemainingM,
        joinedAt: t.createdAt,
      };
    });
  }

  private gameView(game: GameRow, teams: ParticipantRow[]): GameView {
    return {
      id: game.id,
      code: game.joinCode,
      name: game.name,
      status: game.status,
      hostUserId: game.hostUserId,
      settings: this.gameSettings(game),
      nominationOrder: normalizeOrder(game.nominationOrder, teams),
      countdownDeadline: game.countdownDeadline,
      createdAt: game.createdAt,
    };
  }

  previewPool(formations: readonly FormationId[], s: Pick<GameSettings, 'extraMin' | 'extraPct'>): PoolPreview {
    const build = buildAuctionPool(this.opts.reference.activePool(), formations, { extraMin: s.extraMin, extraPct: s.extraPct });
    return {
      teams: formations.length,
      groups: build.groups
        .filter((g) => g.size > 0)
        .map((g) => ({
          group: g.group,
          need: g.need,
          extra: g.extra,
          size: g.size,
          taken: g.taken,
          minOverall: g.minOverall,
          maxOverall: g.maxOverall,
        })),
      totalNeed: build.plan.totalNeed,
      totalSize: build.plan.totalSize,
      unsold: build.plan.totalExtra,
      shortfalls: build.shortfalls,
    };
  }

  private ranking(app: AppSettings): RankedClub[] {
    return this.opts.reference.clubRanking({ formations: app.formations_enabled, compatibility: app.slot_compatibility });
  }

  private aiClubsPreview(teamCount: number, app: AppSettings): AiClubsPreview {
    const ranking = this.ranking(app);
    const count = Math.max(0, LEAGUE_SIZE - teamCount);
    const { method, manualClubIds } = app.ai_club_selection;
    const ids = selectAiClubIds(ranking, count, method, manualClubIds, null);
    return splitClubs(ranking, ids, method, count);
  }

  private startBlockers(game: GameRow, teams: ParticipantRow[], s: GameSettings, pool: PoolPreview, app: AppSettings): StartBlocker[] {
    const out: StartBlocker[] = [];
    if (teams.length < 2) {
      out.push({ code: 'TOO_FEW_TEAMS', message: 'At least 2 teams are needed: invite a friend or add a bot', forceable: false });
    }
    if (teams.length > s.maxTeams) {
      out.push({ code: 'TOO_MANY_TEAMS', message: `This game allows at most ${s.maxTeams} teams`, forceable: false });
    }
    const missing = teams.filter((t) => !t.formation);
    if (missing.length) {
      out.push({ code: 'NO_FORMATION', message: `${names(missing)} must pick a formation`, forceable: false });
    }
    const enabled = new Set<string>(app.formations_enabled);
    const badFormation = teams.filter(
      (t) => t.formation && (!enabled.has(t.formation) || (s.formationRule === 'forced' && t.formation !== s.forcedFormation)),
    );
    if (badFormation.length) {
      out.push({ code: 'FORMATION_DISABLED', message: `${names(badFormation)} must pick an allowed formation`, forceable: false });
    }
    for (const short of pool.shortfalls) {
      out.push({
        code: 'POOL_SHORT',
        message: `Not enough ${short.group} players in the master pool (${short.available} of ${short.required})`,
        forceable: false,
      });
    }
    const notReady = teams.filter((t) => !t.isBot && t.userId !== game.hostUserId && !t.isReady);
    if (notReady.length) {
      out.push({ code: 'NOT_READY', message: `Waiting for ${names(notReady)} to be ready`, forceable: true });
    }
    return out;
  }

  lobbyState(game: GameRow): LobbyUpdate {
    const teams = this.teams(game.id);
    const app = this.appSettings();
    const s = this.gameSettings(game);
    let pool: PoolPreview;
    let aiClubs: AiClubsPreview;
    let startBlockers: StartBlocker[] = [];
    if (game.status === 'lobby' || !game.strengthSnapshot) {
      // Lobby (or a game cancelled before it started): the live preview.
      pool = this.previewPool(
        teams.map((t) => (t.formation ?? '4-3-3') as FormationId),
        s,
      );
      aiClubs = this.aiClubsPreview(teams.length, app);
      if (game.status === 'lobby') startBlockers = this.startBlockers(game, teams, s, pool, app);
    } else {
      pool = game.poolSummary as unknown as PoolPreview;
      const snap = game.strengthSnapshot as unknown as StrengthSnapshot;
      const ids = game.aiClubIds ?? [];
      aiClubs = splitClubs(snap.clubs, ids, snap.method, ids.length);
    }
    return {
      serverTime: Date.now(),
      game: this.gameView(game, teams),
      participants: this.participantViews(game, teams),
      pool,
      aiClubs,
      startBlockers,
    };
  }

  private chatHistory(gameId: string): ChatMessageView[] {
    return this.db
      .select({ id: chatMessages.id, userId: chatMessages.userId, body: chatMessages.body, createdAt: chatMessages.createdAt, name: users.displayName })
      .from(chatMessages)
      .leftJoin(users, eq(users.id, chatMessages.userId))
      .where(eq(chatMessages.gameId, gameId))
      .orderBy(desc(chatMessages.id))
      .limit(CHAT_HISTORY)
      .all()
      .reverse()
      .map((m) => ({ ...m, name: m.name ?? 'Unknown' }));
  }

  snapshot(game: GameRow): GameSnapshot {
    return { ...this.lobbyState(game), chat: this.chatHistory(game.id) };
  }

  snapshotByCode(code: string): GameSnapshot {
    return this.snapshot(this.findGame(code));
  }

  private broadcastLobby(gameId: string): void {
    this.broadcaster.lobbyUpdate(gameId, this.lobbyState(this.gameById(gameId)));
  }

  publicLobbies(): PublicLobby[] {
    if (!this.appSettings().public_lobbies_enabled) return [];
    const rows = this.db
      .select({ game: games, hostName: users.displayName })
      .from(games)
      .innerJoin(users, eq(users.id, games.hostUserId))
      .where(eq(games.status, 'lobby'))
      .orderBy(desc(games.createdAt))
      .limit(100)
      .all();
    const out: PublicLobby[] = [];
    for (const { game, hostName } of rows) {
      const s = this.gameSettings(game);
      if (s.visibility !== 'public' || game.countdownDeadline !== null) continue;
      const teams = this.teams(game.id).length;
      if (teams >= s.maxTeams) continue;
      out.push({ code: game.joinCode, name: game.name, hostName, teams, maxTeams: s.maxTeams, createdAt: game.createdAt });
      if (out.length >= 30) break;
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Create and join

  private uniqueCode(): string {
    for (let i = 0; i < 50; i++) {
      const code = randomJoinCode();
      if (!this.db.select({ id: games.id }).from(games).where(eq(games.joinCode, code)).get()) return code;
    }
    throw new ApiError(500, 'NO_CODE', 'Could not allocate a game code');
  }

  create(user: UserRow, input: { name: string; settings: Partial<GameSettings>; team: TeamInput & { formation: FormationId } }): { code: string } {
    const app = this.appSettings();
    this.checkClean(input.name, 'game name', app);
    const settings = this.validateSettings({ ...app.game_defaults, ...input.settings }, app);
    this.checkClean(input.team.teamName, 'team name', app);
    this.checkClean(input.team.monogram, 'monogram', app);
    const formation = this.resolveFormation(input.team.formation, settings, app);
    const code = this.uniqueCode();
    this.db.transaction((tx) => {
      const game = tx
        .insert(games)
        .values({ joinCode: code, name: input.name, hostUserId: user.id, settings, nominationOrder: [] })
        .returning()
        .get();
      const p = tx
        .insert(participants)
        .values({
          gameId: game.id,
          userId: user.id,
          teamName: input.team.teamName,
          color: input.team.color,
          monogram: input.team.monogram,
          formation,
          budgetRemainingM: settings.budgetM,
        })
        .returning()
        .get();
      tx.update(games).set({ nominationOrder: [p.id] }).where(eq(games.id, game.id)).run();
      audit(tx, { actorUserId: user.id, action: 'game.create', target: code, gameId: game.id, details: { name: input.name } });
    });
    return { code };
  }

  /** Play Solo vs Bots: a game with you plus an Easy, a Medium and a Hard bot, ready to start. */
  createSolo(user: UserRow, team: TeamInput & { formation: FormationId }): { code: string } {
    const name = `${user.displayName}'s solo game`.slice(0, 40);
    const { code } = this.create(user, { name: name.length >= 3 ? name : 'Solo game', settings: { visibility: 'private', botsAllowed: true }, team });
    for (const level of ['easy', 'medium', 'hard'] as const) this.addBot(user, code, { level });
    return { code };
  }

  join(user: UserRow, code: string, input: TeamInput & { formation: FormationId }): { participantId: string } {
    const game = this.findGame(code);
    this.requireLobby(game);
    if (this.participantOf(game.id, user.id)) throw conflict('ALREADY_JOINED', 'You are already in this game');
    const s = this.gameSettings(game);
    if (this.teams(game.id).length >= s.maxTeams) throw conflict('GAME_FULL', 'This game is full');
    const team = this.validTeam(game, input, null);
    const p = this.db
      .insert(participants)
      .values({ gameId: game.id, userId: user.id, ...team, budgetRemainingM: s.budgetM, createdAt: this.nextJoinTime(game.id) })
      .returning()
      .get();
    this.db
      .update(games)
      .set({ nominationOrder: [...(game.nominationOrder ?? []), p.id], updatedAt: Date.now() })
      .where(eq(games.id, game.id))
      .run();
    this.broadcastLobby(game.id);
    return { participantId: p.id };
  }

  updateTeam(user: UserRow, code: string, input: TeamPatchInput & { formation?: FormationId }): void {
    const game = this.findGame(code);
    this.requireLobby(game);
    const me = this.requireParticipant(game, user);
    const app = this.appSettings();
    const changes: Partial<ParticipantRow> = {};
    if (input.teamName !== undefined && input.teamName !== me.teamName) {
      this.checkTeamName(game.id, input.teamName, me.id, app);
      changes.teamName = input.teamName;
    }
    if (input.color !== undefined) changes.color = input.color;
    if (input.monogram !== undefined) {
      this.checkClean(input.monogram, 'monogram', app);
      changes.monogram = input.monogram;
    }
    if (input.formation !== undefined) {
      const s = this.gameSettings(game);
      if (s.formationRule === 'forced' && input.formation !== s.forcedFormation) {
        throw badRequest('FORMATION_FORCED', `The host has set every team to ${s.forcedFormation}`);
      }
      changes.formation = this.resolveFormation(input.formation, s, app);
    }
    if (input.isReady !== undefined) changes.isReady = input.isReady;
    if (Object.keys(changes).length === 0) return;
    this.db.update(participants).set(changes).where(eq(participants.id, me.id)).run();
    this.touch(game.id);
    this.broadcastLobby(game.id);
  }

  leave(user: UserRow, code: string): void {
    const game = this.findGame(code);
    this.requireLobby(game);
    const me = this.requireParticipant(game, user);
    const remaining = this.teams(game.id).filter((t) => t.id !== me.id);
    this.db.transaction((tx) => {
      tx.delete(participants).where(eq(participants.id, me.id)).run();
      const order = (game.nominationOrder ?? []).filter((id) => id !== me.id);
      const set: Partial<GameRow> = { nominationOrder: order, updatedAt: Date.now() };
      if (game.hostUserId === user.id) {
        const heir = remaining.find((t) => !t.isBot && t.userId);
        if (heir?.userId) {
          set.hostUserId = heir.userId;
          audit(tx, { actorUserId: user.id, action: 'game.host.transfer', target: heir.userId, gameId: game.id, details: { reason: 'host left' } });
        } else {
          set.status = 'cancelled';
          audit(tx, { actorUserId: user.id, action: 'game.cancel', target: game.joinCode, gameId: game.id, details: { reason: 'host left' } });
        }
      }
      tx.update(games).set(set).where(eq(games.id, game.id)).run();
    });
    this.broadcastLobby(game.id);
  }

  // -------------------------------------------------------------------------
  // Host controls

  updateSettings(user: UserRow, code: string, input: { name?: string; settings: Partial<GameSettings> }): void {
    const game = this.findGame(code);
    this.requireHost(game, user);
    this.requireLobby(game);
    const app = this.appSettings();
    if (input.name !== undefined) this.checkClean(input.name, 'game name', app);
    const current = this.gameSettings(game);
    const merged: GameSettings = { ...current, ...input.settings };
    if (merged.formationRule === 'forced' && !merged.forcedFormation) {
      merged.forcedFormation = (this.teams(game.id).find((t) => t.userId === game.hostUserId)?.formation as FormationId) ?? '4-3-3';
    }
    if (merged.formationRule === 'each') merged.forcedFormation = null;
    const s = this.validateSettings(merged, app);
    const teams = this.teams(game.id);
    if (s.maxTeams < teams.length) throw conflict('TOO_MANY_TEAMS', `${teams.length} teams have joined already`);
    if (!s.botsAllowed && teams.some((t) => t.isBot)) throw conflict('BOTS_PRESENT', 'Remove the bots before switching bots off');
    this.db.transaction((tx) => {
      tx.update(games)
        .set({ settings: s, ...(input.name ? { name: input.name } : {}), updatedAt: Date.now() })
        .where(eq(games.id, game.id))
        .run();
      if (s.budgetM !== current.budgetM) tx.update(participants).set({ budgetRemainingM: s.budgetM }).where(eq(participants.gameId, game.id)).run();
      if (s.formationRule === 'forced' && s.forcedFormation) {
        tx.update(participants).set({ formation: s.forcedFormation }).where(eq(participants.gameId, game.id)).run();
      }
      audit(tx, { actorUserId: user.id, action: 'game.settings', target: game.joinCode, gameId: game.id, details: { ...input.settings, ...(input.name ? { name: input.name } : {}) } });
    });
    this.broadcastLobby(game.id);
  }

  addBot(user: UserRow, code: string, input: AddBotInput): { participantId: string } {
    const game = this.findGame(code);
    this.requireHost(game, user);
    this.requireLobby(game);
    const s = this.gameSettings(game);
    const app = this.appSettings();
    if (!s.botsAllowed) throw conflict('BOTS_OFF', 'Bots are switched off for this game');
    const teams = this.teams(game.id);
    if (teams.length >= s.maxTeams) throw conflict('GAME_FULL', 'This game is full');
    const names = new Set(teams.map((t) => t.teamName?.toLowerCase()));
    const teamName = BOT_TEAM_NAMES.find((n) => !names.has(n.toLowerCase())) ?? `Bot Team ${teams.length + 1}`;
    const colors = new Set(teams.map((t) => t.color));
    const color = TEAM_COLORS.find((c) => !colors.has(c)) ?? TEAM_COLORS[teams.length % TEAM_COLORS.length]!;
    const enabled = app.formations_enabled;
    const formation =
      s.formationRule === 'forced' && s.forcedFormation
        ? s.forcedFormation
        : input.formation
          ? this.resolveFormation(input.formation, s, app)
          : cryptoShuffle(enabled)[0]!;
    const level = input.level ?? 'medium';
    const p = this.db.transaction((tx) => {
      const row = tx
        .insert(participants)
        .values({
          gameId: game.id,
          userId: null,
          teamName,
          color,
          monogram: defaultMonogram(teamName),
          formation,
          isBot: true,
          botLevel: level,
          isReady: true,
          isConnected: true,
          budgetRemainingM: s.budgetM,
          createdAt: this.nextJoinTime(game.id),
        })
        .returning()
        .get();
      tx.update(games)
        .set({ nominationOrder: [...(game.nominationOrder ?? []), row.id], updatedAt: Date.now() })
        .where(eq(games.id, game.id))
        .run();
      audit(tx, { actorUserId: user.id, action: 'game.bot.add', target: row.id, gameId: game.id, details: { level, teamName } });
      return row;
    });
    this.broadcastLobby(game.id);
    return { participantId: p.id };
  }

  updateBot(user: UserRow, code: string, participantId: string, input: BotPatchInput): void {
    const game = this.findGame(code);
    this.requireHost(game, user);
    this.requireLobby(game);
    const bot = this.teams(game.id).find((t) => t.id === participantId);
    if (!bot) throw notFound('PARTICIPANT_NOT_FOUND', 'No such team in this game');
    if (!bot.isBot) throw badRequest('NOT_A_BOT', 'Only bots can be edited by the host');
    const s = this.gameSettings(game);
    const changes: Partial<ParticipantRow> = {};
    if (input.level) changes.botLevel = input.level;
    if (input.formation) {
      if (s.formationRule === 'forced' && input.formation !== s.forcedFormation) {
        throw badRequest('FORMATION_FORCED', `Every team plays ${s.forcedFormation}`);
      }
      changes.formation = this.resolveFormation(input.formation, s, this.appSettings());
    }
    if (Object.keys(changes).length === 0) return;
    this.db.update(participants).set(changes).where(eq(participants.id, bot.id)).run();
    audit(this.db, { actorUserId: user.id, action: 'game.bot.update', target: bot.id, gameId: game.id, details: changes });
    this.touch(game.id);
    this.broadcastLobby(game.id);
  }

  /** Kick a human or remove a bot (lobby only). */
  removeParticipant(user: UserRow, code: string, participantId: string): void {
    const game = this.findGame(code);
    this.requireHost(game, user);
    this.requireLobby(game);
    const target = this.teams(game.id).find((t) => t.id === participantId);
    if (!target) throw notFound('PARTICIPANT_NOT_FOUND', 'No such team in this game');
    if (target.userId && target.userId === game.hostUserId) throw badRequest('CANNOT_KICK_HOST', 'Transfer host before removing that team');
    this.db.transaction((tx) => {
      tx.delete(participants).where(eq(participants.id, target.id)).run();
      tx.update(games)
        .set({ nominationOrder: (game.nominationOrder ?? []).filter((id) => id !== target.id), updatedAt: Date.now() })
        .where(eq(games.id, game.id))
        .run();
      audit(tx, {
        actorUserId: user.id,
        action: target.isBot ? 'game.bot.remove' : 'game.kick',
        target: target.userId ?? target.id,
        gameId: game.id,
        details: { teamName: target.teamName },
      });
    });
    if (target.userId) this.broadcaster.kicked(target.userId, game.id, game.joinCode);
    this.broadcastLobby(game.id);
  }

  transferHost(user: UserRow, code: string, participantId: string): void {
    const game = this.findGame(code);
    this.requireHost(game, user);
    if (game.status === 'cancelled' || game.status === 'completed') throw conflict('GAME_OVER', 'This game is over');
    const target = this.teams(game.id).find((t) => t.id === participantId);
    if (!target) throw notFound('PARTICIPANT_NOT_FOUND', 'No such team in this game');
    if (!target.userId) throw badRequest('BOT_CANNOT_HOST', 'A bot cannot be the host');
    this.db.update(games).set({ hostUserId: target.userId, updatedAt: Date.now() }).where(eq(games.id, game.id)).run();
    audit(this.db, { actorUserId: user.id, action: 'game.host.transfer', target: target.userId, gameId: game.id });
    this.broadcastLobby(game.id);
  }

  setNominationOrder(user: UserRow, code: string, order: string[]): void {
    const game = this.findGame(code);
    this.requireHost(game, user);
    this.requireLobby(game);
    const ids = this.teams(game.id).map((t) => t.id);
    if (order.length !== ids.length || new Set(order).size !== order.length || !order.every((id) => ids.includes(id))) {
      throw badRequest('BAD_ORDER', 'The order must list every team exactly once');
    }
    this.db.update(games).set({ nominationOrder: order, updatedAt: Date.now() }).where(eq(games.id, game.id)).run();
    audit(this.db, { actorUserId: user.id, action: 'game.order.set', target: game.joinCode, gameId: game.id, details: { order } });
    this.broadcastLobby(game.id);
  }

  randomizeNominationOrder(user: UserRow, code: string): string[] {
    const game = this.findGame(code);
    this.requireHost(game, user);
    this.requireLobby(game);
    const order = cryptoShuffle(normalizeOrder(game.nominationOrder, this.teams(game.id)));
    this.db.update(games).set({ nominationOrder: order, updatedAt: Date.now() }).where(eq(games.id, game.id)).run();
    audit(this.db, { actorUserId: user.id, action: 'game.order.randomize', target: game.joinCode, gameId: game.id, details: { order } });
    this.broadcastLobby(game.id);
    return order;
  }

  cancel(user: UserRow, code: string): void {
    const game = this.findGame(code);
    this.requireHost(game, user);
    if (game.status === 'cancelled' || game.status === 'completed') throw conflict('GAME_OVER', 'This game is already over');
    this.opts.timers.cancel(startTimerKey(game.id));
    this.db.update(games).set({ status: 'cancelled', countdownDeadline: null, updatedAt: Date.now() }).where(eq(games.id, game.id)).run();
    audit(this.db, { actorUserId: user.id, action: 'game.cancel', target: game.joinCode, gameId: game.id });
    this.broadcaster.notice(game.id, { code: 'CANCELLED', level: 'info', message: 'The host cancelled this game' });
    this.broadcastLobby(game.id);
  }

  // -------------------------------------------------------------------------
  // Chat and presence

  chat(user: UserRow, code: string, body: string): ChatMessageView {
    const game = this.findGame(code);
    this.requireParticipant(game, user);
    const now = Date.now();
    const key = `${game.id}:${user.id}`;
    const minGap = this.opts.chatMinIntervalMs ?? 400;
    if (now - (this.lastChat.get(key) ?? 0) < minGap) throw new ApiError(429, 'SLOW_DOWN', 'You are sending messages too fast');
    this.lastChat.set(key, now);
    const clean = maskProfanity(body, this.appSettings().profanity_words);
    const row = this.db.insert(chatMessages).values({ gameId: game.id, userId: user.id, body: clean, createdAt: now }).returning().get();
    const message: ChatMessageView = { id: row.id, userId: user.id, name: user.displayName, body: clean, createdAt: now };
    this.broadcaster.chat(game.id, message);
    return message;
  }

  /** The participant id of a user in a game, if any. */
  participantIdFor(gameId: string, userId: string): string | null {
    return this.participantOf(gameId, userId)?.id ?? null;
  }

  setConnected(gameId: string, participantId: string, isConnected: boolean): void {
    this.db
      .update(participants)
      .set({ isConnected, disconnectedAt: isConnected ? null : Date.now() })
      .where(and(eq(participants.id, participantId), eq(participants.isBot, false)))
      .run();
    this.broadcaster.presence(gameId, { participantId, isConnected });
  }

  // -------------------------------------------------------------------------
  // Start

  requestStart(user: UserRow, code: string, force: boolean): { countdownDeadline: number | null } {
    const game = this.findGame(code);
    this.requireHost(game, user);
    this.requireLobby(game);
    const blockers = this.lobbyState(game).startBlockers.filter((b) => !(force && b.forceable));
    if (blockers.length) throw conflict('START_BLOCKED', blockers[0]!.message, blockers);
    audit(this.db, { actorUserId: user.id, action: 'game.start.request', target: game.joinCode, gameId: game.id, details: { force } });
    if (this.opts.startCountdownMs <= 0) {
      this.startNow(game.id, user.id);
      return { countdownDeadline: null };
    }
    const deadline = Date.now() + this.opts.startCountdownMs;
    this.db.update(games).set({ countdownDeadline: deadline, updatedAt: Date.now() }).where(eq(games.id, game.id)).run();
    this.scheduleStart(game.id, this.opts.startCountdownMs);
    this.broadcastLobby(game.id);
    return { countdownDeadline: deadline };
  }

  private scheduleStart(gameId: string, delayMs: number): void {
    this.opts.timers.schedule(startTimerKey(gameId), delayMs, () => this.runScheduledStart(gameId));
  }

  private runScheduledStart(gameId: string): void {
    try {
      this.startNow(gameId, null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The auction could not start';
      this.db.update(games).set({ countdownDeadline: null, updatedAt: Date.now() }).where(eq(games.id, gameId)).run();
      this.broadcaster.notice(gameId, { code: 'START_FAILED', level: 'error', message });
      this.broadcastLobby(gameId);
    }
  }

  /**
   * Freeze order and formations, build and write the auction pool, snapshot club strength, pick the
   * AI clubs, store the seed, give every team its budget and empty slots, and open the auction.
   */
  startNow(gameId: string, actorUserId: string | null): void {
    const game = this.gameById(gameId);
    if (game.status !== 'lobby') return;
    const app = this.appSettings();
    const s = this.gameSettings(game);
    const teams = this.teams(game.id);
    const order = normalizeOrder(game.nominationOrder, teams);
    const byId = new Map(teams.map((t) => [t.id, t]));
    const formations = order.map((id) => byId.get(id)!.formation as FormationId);
    const preview = this.previewPool(formations, s);
    const blockers = this.startBlockers(game, teams, s, preview, app).filter((b) => !b.forceable);
    if (blockers.length) throw conflict('START_BLOCKED', blockers[0]!.message, blockers);

    const build = buildAuctionPool(this.opts.reference.activePool(), formations, { extraMin: s.extraMin, extraPct: s.extraPct });
    const ranking = this.ranking(app);
    const seed = randomSeed();
    const { method, manualClubIds } = app.ai_club_selection;
    const aiClubIds = selectAiClubIds(ranking, LEAGUE_SIZE - teams.length, method, manualClubIds, seed);
    const strength: StrengthSnapshot = { computedAt: Date.now(), method, clubs: ranking };
    const now = Date.now();

    this.db.transaction((tx) => {
      tx.insert(gamePool)
        .values(
          build.players.map((p) => ({
            gameId: game.id,
            poolPlayerId: p.id,
            status: 'available' as const,
            snapshot: {
              id: p.row.id,
              name: p.row.name,
              position: p.row.position,
              altPositions: p.row.altPositions,
              altSource: p.row.altSource,
              overall: p.row.overall,
              positionRank: p.row.positionRank,
              marketValueM: p.row.marketValueM,
              basePriceM: p.row.basePriceM,
              seedClub: p.row.seedClub,
              clubNow: p.row.clubNow,
              nationality: p.row.nationality,
            },
          })),
        )
        .run();
      for (const t of teams) {
        tx.update(participants).set({ budgetRemainingM: s.budgetM }).where(eq(participants.id, t.id)).run();
        tx.insert(lineupSlots)
          .values(FORMATIONS[t.formation as FormationId].slots.map((slot) => ({ participantId: t.id, slotKey: slot.key })))
          .run();
      }
      for (const c of ranking) tx.update(clubs).set({ strengthRating: c.computedStrength }).where(eq(clubs.id, c.id)).run();
      tx.update(games)
        .set({
          status: 'auctioning',
          seed,
          nominationOrder: order,
          nominationIndex: 0,
          poolSummary: preview as unknown as Record<string, unknown>,
          strengthSnapshot: strength as unknown as Record<string, unknown>,
          aiClubIds,
          countdownDeadline: null,
          updatedAt: now,
        })
        .where(eq(games.id, game.id))
        .run();
      audit(tx, {
        actorUserId: actorUserId ?? game.hostUserId,
        action: 'game.start',
        target: game.joinCode,
        gameId: game.id,
        details: { teams: teams.length, poolSize: build.players.length, aiClubIds },
      });
    });
    this.broadcaster.snapshot(game.id, this.snapshot(this.gameById(game.id)));
  }

  // -------------------------------------------------------------------------
  // Boot

  /** After a restart: nobody is connected yet, and pending start countdowns resume. */
  restore(): void {
    this.db.update(participants).set({ isConnected: false }).where(eq(participants.isBot, false)).run();
    const pending = this.db
      .select()
      .from(games)
      .where(and(eq(games.status, 'lobby'), isNotNull(games.countdownDeadline)))
      .all();
    for (const g of pending) this.scheduleStart(g.id, (g.countdownDeadline ?? 0) - Date.now());
  }

  private touch(gameId: string): void {
    this.db.update(games).set({ updatedAt: Date.now() }).where(eq(games.id, gameId)).run();
  }
}

/** Stored order filtered to current teams, with any missing teams appended in join order. */
export function normalizeOrder(order: readonly string[] | null, teams: readonly ParticipantRow[]): string[] {
  const ids = new Set(teams.map((t) => t.id));
  const out = (order ?? []).filter((id) => ids.has(id));
  for (const t of teams) if (!out.includes(t.id)) out.push(t.id);
  return out;
}

function splitClubs(ranking: readonly RankedClub[], ids: readonly string[], method: AiClubsPreview['method'], count: number): AiClubsPreview {
  const chosen = new Set(ids);
  const strip = ({ id, name, shortName, monogram, primaryColor, secondaryColor, strength, rank }: RankedClub) => ({
    id,
    name,
    shortName,
    monogram,
    primaryColor,
    secondaryColor,
    strength,
    rank,
  });
  const inLeague = ranking.filter((c) => chosen.has(c.id)).map(strip);
  const leftOut = chosen.size ? ranking.filter((c) => !chosen.has(c.id)).map(strip) : [];
  return { method, count, inLeague, leftOut };
}

function names(teams: readonly ParticipantRow[]): string {
  const list = teams.map((t) => t.teamName ?? 'a team');
  return list.length <= 2 ? list.join(' and ') : `${list.slice(0, 2).join(', ')} and ${list.length - 2} more`;
}
