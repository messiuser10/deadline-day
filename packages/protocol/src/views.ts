/** Shapes the server sends: REST responses, the game snapshot, and Socket.IO events. */
import type { FormationId, Group, KeyMomentKind, Position, SlotType } from '@deadline-day/engine';
import type { GameLimits } from './limits';
import type { PlaybackClock } from './playback';
import type { GameSettings } from './schemas';

export type Role = 'admin' | 'user';
export type GameStatus = 'lobby' | 'auctioning' | 'paused' | 'auction_complete' | 'simulating' | 'completed' | 'cancelled';
export type BotLevel = 'easy' | 'medium' | 'hard';
/** Who runs a human team during the auction: its manager, a bot that took over, or auto-nominate only. */
export type TeamControl = 'human' | 'bot' | 'auto';

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
  control: TeamControl;
  /** When a human manager's last tab disconnected (null while connected, and for bots). */
  disconnectedAt: number | null;
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

// ---------------------------------------------------------------------------
// Live auction (section 8)

export type PlayerStatus = 'available' | 'live' | 'sold' | 'unsold';

export interface AuctionPlayerView {
  id: string;
  name: string;
  position: Group;
  altPositions: Group[];
  overall: number;
  marketValueM: number;
  basePriceM: number;
  positionRank: number;
  /** Real club as of the data date (display only). */
  clubNow: string | null;
  nationality: string | null;
  status: PlayerStatus;
  soldTo: string | null;
  priceM: number | null;
  autoFilled: boolean;
}

export interface AuctionSlotView {
  key: string;
  type: SlotType;
  playerId: string | null;
  priceM: number | null;
  autoFilled: boolean;
  /** Playing an alternate position in this slot. */
  outOfPosition: boolean;
}

export interface AuctionTeamView {
  participantId: string;
  budgetM: number;
  spentM: number;
  /** Largest bid the team could make on a single player right now (reserve rule). */
  maxBidM: number;
  filled: number;
  slots: AuctionSlotView[];
  /** Mean overall of the players bought so far. */
  averageOverall: number | null;
}

export interface LotBidView {
  participantId: string;
  amountM: number;
  at: number;
  isBot: boolean;
}

/** Whether a team may bid on the live lot, and its max bid for this player. */
export interface LotEligibility {
  ok: boolean;
  code: 'NO_SLOT' | 'WOULD_STRAND_TEAM' | 'TEAM_FULL' | null;
  maxBidM: number;
}

export interface LotView {
  id: string;
  sequence: number;
  playerId: string;
  nominatorId: string;
  openingBidM: number;
  currentBidM: number;
  leaderId: string;
  autoNominated: boolean;
  startedAt: number;
  bids: LotBidView[];
  eligibility: Record<string, LotEligibility>;
}

export interface SaleView {
  /** Lot sequence, or null for an auto-fill. */
  sequence: number | null;
  playerId: string;
  participantId: string;
  priceM: number;
  autoFilled: boolean;
  autoNominated: boolean;
  at: number;
}

export interface PauseView {
  byUserId: string | null;
  byName: string;
  timer: 'nomination' | 'lot' | 'countdown';
  remainingMs: number;
}

export interface AuctionView {
  /** Increases with every auction change; clients ignore anything older than what they hold. */
  version: number;
  phase: 'nominating' | 'bidding' | 'complete';
  nominatorId: string | null;
  nominationDeadline: number | null;
  lotDeadline: number | null;
  /** Post-auction countdown to the season (null while held or when auto-start is off). */
  countdownDeadline: number | null;
  paused: PauseView | null;
  lot: LotView | null;
  players: AuctionPlayerView[];
  /** In nomination order. */
  teams: AuctionTeamView[];
  sales: SaleView[];
  bought: number;
  totalSlots: number;
  canUndo: boolean;
  revealStartedAt: number | null;
  timers: { nominationMs: number; lotMs: number; antiSnipeMs: number; minIncrementM: number };
}

/** One accepted bid: the live lot's new price, leader and deadline. */
export interface BidEvent {
  version: number;
  lotId: string;
  sequence: number;
  bid: LotBidView;
  currentBidM: number;
  leaderId: string;
  lotDeadline: number;
}

export interface RevealSlot {
  key: string;
  type: SlotType;
  playerId: string;
  name: string;
  position: Group;
  overall: number;
  priceM: number;
  marketValueM: number;
  autoFilled: boolean;
  outOfPosition: boolean;
}

export interface RevealTeam {
  participantId: string;
  teamName: string;
  managerName: string;
  color: string;
  monogram: string;
  formation: FormationId;
  isBot: boolean;
  slots: RevealSlot[];
  spentM: number;
  leftM: number;
  attack: number;
  defense: number;
  strength: number;
  rank: number;
  grade: string;
  gradeScore: number;
}

export interface RevealLeagueRow {
  id: string;
  name: string;
  kind: 'human' | 'bot' | 'ai';
  participantId: string | null;
  color: string;
  monogram: string;
  attack: number;
  defense: number;
  strength: number;
  rank: number;
}

export interface RevealView {
  revealStartedAt: number;
  /** How long each team is shown when the reveal plays by itself. */
  stepMs: number;
  /** Reveal order: weakest first, strongest last. */
  teams: RevealTeam[];
  unsold: { id: string; name: string; position: Group; overall: number; basePriceM: number }[];
  league: RevealLeagueRow[];
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
  /** Live auction state once the auction has started. */
  auction: AuctionView | null;
  /** Seasons played and the playback clock, once the first season has been simulated. */
  season: SeasonInfo | null;
}

/** Lobby state pushed after every lobby change: the snapshot without chat history or auction state. */
export type LobbyUpdate = Omit<GameSnapshot, 'chat' | 'auction'>;

export interface PresenceEvent {
  participantId: string;
  isConnected: boolean;
  disconnectedAt: number | null;
}

export interface ServerToClientEvents {
  'game:snapshot': (snapshot: GameSnapshot) => void;
  'lobby:update': (update: LobbyUpdate) => void;
  presence: (p: PresenceEvent) => void;
  'chat:message': (message: ChatMessageView) => void;
  'auction:state': (view: AuctionView) => void;
  'auction:bid': (bid: BidEvent) => void;
  'auction:sold': (sale: SaleView) => void;
  'season:playback': (playback: PlaybackView) => void;
  'game:kicked': (p: { code: string }) => void;
  'game:notice': (p: { code: string; level: 'info' | 'error'; message: string }) => void;
}

export type WatchAck = { ok: true; snapshot: GameSnapshot } | { ok: false; error: ApiErrorBody['error'] };

export interface ClientToServerEvents {
  'game:watch': (p: { code: string }, ack: (res: WatchAck) => void) => void;
  'game:unwatch': (p: { code: string }) => void;
  'time:sync': (ack: (serverTime: number) => void) => void;
}

// ---------------------------------------------------------------------------
// Season (section 10)

export type PlaybackMode = 'synchronized' | 'own_pace';

/** The shared playback clock. In own-pace mode every client keeps its own clock and this one is unused. */
export interface PlaybackView extends PlaybackClock {
  mode: PlaybackMode;
  /** Season number the clock belongs to (the latest season). */
  season: number;
  version: number;
}

export interface SeasonSummary {
  number: number;
  championId: string;
  championName: string;
  createdAt: number;
}

export interface SeasonInfo {
  /** Oldest first. */
  seasons: SeasonSummary[];
  playback: PlaybackView;
}

export interface SeasonPlayerView {
  /** pool:<id>, seed:<id> or reserve:<club>:<slot>. */
  ref: string;
  name: string;
  slotKey: string;
  slotType: SlotType;
  position: Position;
  /** Effective overall in this slot. */
  overall: number;
  baseOverall: number;
  outOfPosition: boolean;
  reserve: boolean;
}

export interface SeasonTeamView {
  /** Season team id (stable within a season). */
  id: string;
  kind: 'human' | 'bot' | 'ai';
  participantId: string | null;
  clubId: string | null;
  name: string;
  managerName: string | null;
  color: string;
  secondaryColor: string;
  monogram: string;
  formation: FormationId;
  attack: number;
  defense: number;
  chemistry: number;
  strength: number;
  /** Pre-season strength rank, 1 = strongest. */
  rank: number;
  players: SeasonPlayerView[];
}

export interface MatchEventView {
  minute: number;
  type: 'goal' | 'assist' | 'yellow' | 'red';
  playerRef: string;
  teamId: string;
}

export interface FixtureView {
  id: number;
  matchday: number;
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
  /** In minute order. */
  events: MatchEventView[];
}

export interface StandingView {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  position: number;
  /** Last five, oldest first, e.g. "WWDLW". */
  form: string;
}

export interface KeyMomentView {
  matchday: number;
  minute: number;
  kind: KeyMomentKind;
  fixtureId: number | null;
  teamId: string;
  otherTeamId: string | null;
  playerRef: string | null;
  goals: number | null;
  conceded: number | null;
  teamPosition: number | null;
  otherPosition: number | null;
}

export type TableBandTone = 'gold' | 'green' | 'blue' | 'red';

/** A coloured band of table positions (admin-editable). */
export interface TableBand {
  from: number;
  to: number;
  label: string;
  tone: TableBandTone;
  enabled: boolean;
}

export interface SeasonView {
  number: number;
  seed: number;
  matchdays: number;
  /** Ordered by pre-season strength. */
  teams: SeasonTeamView[];
  /** Players who are not in a starting XI (injury cover), by ref. */
  extras: { ref: string; name: string; teamId: string }[];
  fixtures: FixtureView[];
  /** standings[i] is the table after matchday i + 1. */
  standings: StandingView[][];
  moments: KeyMomentView[];
  championId: string;
  bands: TableBand[];
  goalsPerMatch: number;
}

export interface ExpectedStrengthTeam {
  teamId: string;
  avgPoints: number;
  avgPosition: number;
  titleChance: number;
  top4Chance: number;
  bottom3Chance: number;
}

/** Monte Carlo over the latest season's 20 teams ("Expected Strength"). */
export interface ExpectedStrengthView {
  season: number;
  runs: number;
  goalsPerMatch: number;
  teams: ExpectedStrengthTeam[];
}

export interface MultiSeasonView {
  seasons: number;
  run: number;
  /** One entry per simulated season. */
  champions: { season: number; teamId: string; points: number }[];
  titles: { teamId: string; titles: number; avgPoints: number; avgPosition: number; bestFinish: number }[];
}

export interface LeagueTeamRow {
  /** Season team id once a season exists, else the participant or club id. */
  id: string;
  kind: 'human' | 'bot' | 'ai';
  participantId: string | null;
  clubId: string | null;
  name: string;
  managerName: string | null;
  color: string;
  monogram: string;
  formation: FormationId;
  attack: number;
  defense: number;
  chemistry: number;
  strength: number;
  rank: number;
  /** Players in the XI so far (11 once complete). */
  filled: number;
  /** Rated on an incomplete XI while the auction runs. */
  provisional: boolean;
  players: SeasonPlayerView[];
}

/** The League Teams page: all 20 teams ranked by strength. */
export interface LeagueView {
  /** Season the teams come from, or null while the auction runs. */
  season: number | null;
  teams: LeagueTeamRow[];
}
