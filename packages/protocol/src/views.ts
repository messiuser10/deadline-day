/** Shapes the server sends: REST responses, the game snapshot, and Socket.IO events. */
import type { FormationId, Group } from '@deadline-day/engine';
import type { GameLimits } from './limits';
import type { GameSettings } from './schemas';

export type Role = 'admin' | 'user';
export type GameStatus = 'lobby' | 'auctioning' | 'paused' | 'auction_complete' | 'simulating' | 'completed' | 'cancelled';
export type BotLevel = 'easy' | 'medium' | 'hard';

export interface UserView {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface PublicSettings {
  leagueName: string;
  formationsEnabled: FormationId[];
  gameDefaults: GameSettings;
  gameLimits: GameLimits;
  registrationsOpen: boolean;
  publicLobbiesEnabled: boolean;
  maintenanceBanner: string | null;
}

export interface PublicLobby {
  code: string;
  name: string;
  hostName: string;
  teams: number;
  maxTeams: number;
  createdAt: number;
}

export interface ParticipantView {
  id: string;
  userId: string | null;
  /** Manager name: the user's display name, or "Bot (Medium)". */
  managerName: string;
  teamName: string;
  color: string;
  monogram: string;
  formation: FormationId;
  isReady: boolean;
  isBot: boolean;
  botLevel: BotLevel | null;
  isConnected: boolean;
  isHost: boolean;
  isGuest: boolean;
  budgetRemainingM: number;
  joinedAt: number;
}

export interface PoolGroupPreview {
  group: Group;
  need: number;
  extra: number;
  size: number;
  /** Players actually available (less than size only when the master pool is short). */
  taken: number;
  minOverall: number | null;
  maxOverall: number | null;
}

export interface PoolPreview {
  teams: number;
  groups: PoolGroupPreview[];
  totalNeed: number;
  totalSize: number;
  unsold: number;
  shortfalls: { group: Group; required: number; available: number }[];
}

export interface ClubPreview {
  id: string;
  name: string;
  shortName: string;
  monogram: string;
  primaryColor: string;
  secondaryColor: string;
  strength: number;
  rank: number;
}

export interface AiClubsPreview {
  method: 'top_by_strength' | 'manual' | 'random';
  count: number;
  /** Empty for the random method until the auction starts. */
  inLeague: ClubPreview[];
  leftOut: ClubPreview[];
}

export interface ChatMessageView {
  id: number;
  userId: string | null;
  name: string;
  body: string;
  createdAt: number;
}

export interface GameView {
  id: string;
  code: string;
  name: string;
  status: GameStatus;
  hostUserId: string;
  settings: GameSettings;
  /** Participant ids in nomination order (lobby order until start, then frozen). */
  nominationOrder: string[];
  /** Start countdown deadline (epoch ms) while the 5-second countdown runs. */
  countdownDeadline: number | null;
  createdAt: number;
}

export interface StartBlocker {
  code: 'TOO_FEW_TEAMS' | 'NOT_READY' | 'NO_FORMATION' | 'FORMATION_DISABLED' | 'POOL_SHORT' | 'TOO_MANY_TEAMS';
  message: string;
  /** NOT_READY is the only blocker the host can override with Force start. */
  forceable: boolean;
}

export interface GameSnapshot {
  serverTime: number;
  game: GameView;
  participants: ParticipantView[];
  /** Live preview in the lobby; the frozen pool summary once the auction has started. */
  pool: PoolPreview;
  aiClubs: AiClubsPreview;
  startBlockers: StartBlocker[];
  chat: ChatMessageView[];
}

/** Lobby state pushed after every lobby change: the snapshot without chat history. */
export type LobbyUpdate = Omit<GameSnapshot, 'chat'>;

export interface ServerToClientEvents {
  'game:snapshot': (snapshot: GameSnapshot) => void;
  'lobby:update': (update: LobbyUpdate) => void;
  presence: (p: { participantId: string; isConnected: boolean }) => void;
  'chat:message': (message: ChatMessageView) => void;
  'game:kicked': (p: { code: string }) => void;
  'game:notice': (p: { code: string; level: 'info' | 'error'; message: string }) => void;
}

export type WatchAck = { ok: true; snapshot: GameSnapshot } | { ok: false; error: ApiErrorBody['error'] };

export interface ClientToServerEvents {
  'game:watch': (p: { code: string }, ack: (res: WatchAck) => void) => void;
  'game:unwatch': (p: { code: string }) => void;
  'time:sync': (ack: (serverTime: number) => void) => void;
}
